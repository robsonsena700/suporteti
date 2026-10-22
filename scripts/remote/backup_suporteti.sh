#!/bin/bash
#
# Backup diário do banco "suporteti" com rotação por ciclo (daily, weekly,
# 15days, monthly, 6months, yearly). Pensado para rodar via cron no servidor
# de produção (ex.: crontab do usuário "whs", 1x por dia de madrugada).
#
# Correções/otimizações em relação à versão anterior (não versionada):
#   1. A limpeza do ciclo "daily" usava `find -mtime +1`, que é baseado em
#      tempo (não em contagem). Se o cron atrasar/adiantar um pouco entre
#      execuções, o arquivo do dia anterior pode ter menos de "1 dia" exato
#      de diferença no momento em que o find roda, e não é removido - foi
#      exatamente isso que deixou 2 arquivos em daily/ em vez de 1. Troquei
#      para o mesmo padrão `ls -t | tail -n +N` já usado nos outros ciclos,
#      que conta quantidade de arquivos (robusto a qualquer variação de
#      horário do cron).
#   2. Removido o `gzip` aplicado sobre o dump: `pg_dump -Fc` já produz um
#      arquivo comprimido (formato custom, compressão zlib interna). Compactar
#      de novo com gzip ganha quase nada (às vezes nada) e, durante a
#      compactação, usa temporariamente até 2x o espaço do arquivo em disco -
#      desperdício de CPU e de margem de disco livre sem benefício real.
#   3. Adicionado "trap" para apagar o arquivo temporário em /tmp se o script
#      falhar no meio do caminho (antes não tinha; com `set -e`, uma falha no
#      meio deixava lixo acumulando em /tmp sem nunca ser limpo).
#   4. KEEP_DAILY é configurável (padrão 2): mantém o backup de hoje + o de
#      ontem como margem de segurança, em vez de só 1 - evita ficar sem
#      nenhum backup utilizável se o dump de hoje vier corrompido e você só
#      notar no dia seguinte. Ajuste para 1 se preferir o mínimo absoluto.
#
# Arquivos agora ficam como "suporteti_<data>.backup" (sem ".gz" duplicado).
# Para restaurar: pg_restore -h localhost -p 5433 -U postgres -d suporteti --clean /caminho/suporteti_AAAA-MM-DD_HH-MM.backup
# Arquivos antigos (ainda ".backup.gz" de antes desta correção) continuam
# restauráveis normalmente: basta descompactar primeiro (`gunzip arquivo.gz`)
# e depois usar o mesmo pg_restore acima.

set -eu
if (set -o pipefail) 2>/dev/null; then
  set -o pipefail
fi

BASE_DIR="/home/whs/backups"
DATA=$(date +"%Y-%m-%d_%H-%M")
DIA_SEMANA=$(date +%u)   # 1-7 (segunda=1)
DIA_MES=$(date +%d)      # 01-31
MES=$(date +%m)          # 01-12

# remove zero à esquerda (evita o bash interpretar como octal)
DIA_MES=$((10#$DIA_MES))
MES=$((10#$MES))

# quantos backups manter em cada ciclo
KEEP_DAILY="${KEEP_DAILY:-2}"
KEEP_WEEKLY=1
KEEP_15DAYS=1
KEEP_MONTHLY=1
KEEP_6MONTHS=1
KEEP_YEARLY=1

# diretórios por ciclo
DAILY="$BASE_DIR/daily"
WEEKLY="$BASE_DIR/weekly"
F15="$BASE_DIR/15days"
MONTHLY="$BASE_DIR/monthly"
M6="$BASE_DIR/6months"
YEARLY="$BASE_DIR/yearly"

mkdir -p "$DAILY" "$WEEKLY" "$F15" "$MONTHLY" "$M6" "$YEARLY"

# ========================
# 1. BACKUP DIÁRIO
# ========================

TMP_FILE="/tmp/suporteti_$DATA.backup.$$"
ARQ_DAILY="$DAILY/suporteti_$DATA.backup"

# limpa o arquivo temporário automaticamente se o script falhar antes do mv
trap 'rm -f "$TMP_FILE"' EXIT

# dump em local seguro (formato custom = já comprimido, permite pg_restore seletivo)
sudo -u postgres pg_dump -Fc suporteti -f "$TMP_FILE"

# mover para destino (mesma partição -> rename instantâneo, sem gasto extra de espaço)
mv "$TMP_FILE" "$ARQ_DAILY"

# ========================
# 2. PROMOÇÕES DE CICLO
# ========================

# semanal (domingo)
if [ "$DIA_SEMANA" -eq 7 ]; then
    cp "$ARQ_DAILY" "$WEEKLY/"
fi

# a cada 15 dias (dia 1 e 15)
if [ "$DIA_MES" -eq 1 ] || [ "$DIA_MES" -eq 15 ]; then
    cp "$ARQ_DAILY" "$F15/"
fi

# mensal (dia 1)
if [ "$DIA_MES" -eq 1 ]; then
    cp "$ARQ_DAILY" "$MONTHLY/"
fi

# 6 meses (jan e jul)
if [ "$DIA_MES" -eq 1 ] && ([ "$MES" -eq 1 ] || [ "$MES" -eq 7 ]); then
    cp "$ARQ_DAILY" "$M6/"
fi

# anual (1 de janeiro)
if [ "$DIA_MES" -eq 1 ] && [ "$MES" -eq 1 ]; then
    cp "$ARQ_DAILY" "$YEARLY/"
fi

# ========================
# 3. LIMPEZA (mantém só o necessário por ciclo, por contagem - não por tempo)
# ========================

prune_cycle() {
  local dir="$1"
  local keep="$2"
  ls -t "$dir"/*.backup "$dir"/*.backup.gz 2>/dev/null | tail -n +"$((keep + 1))" | xargs -r rm --
}

prune_cycle "$DAILY" "$KEEP_DAILY"
prune_cycle "$WEEKLY" "$KEEP_WEEKLY"
prune_cycle "$F15" "$KEEP_15DAYS"
prune_cycle "$MONTHLY" "$KEEP_MONTHLY"
prune_cycle "$M6" "$KEEP_6MONTHS"
prune_cycle "$YEARLY" "$KEEP_YEARLY"

echo "BACKUP_OK: $ARQ_DAILY"
