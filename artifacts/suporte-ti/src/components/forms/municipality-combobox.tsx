import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Check, ChevronsUpDown, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export interface MunicipalityComboboxProps {
  uf: string;
  value: string;
  options: string[];
  disabled?: boolean;
  loading?: boolean;
  onChange: (value: string) => void;
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function MunicipalityCombobox({
  uf,
  value,
  options,
  disabled,
  loading,
  onChange,
}: MunicipalityComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");

  useEffect(() => {
    const id = window.setTimeout(() => {
      setDebouncedQuery(query);
    }, 180);
    return () => window.clearTimeout(id);
  }, [query]);

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const filteredOptions = useMemo(() => {
    if (!debouncedQuery.trim()) return options;
    const normalized = normalizeText(debouncedQuery);
    return options.filter((name) => normalizeText(name).includes(normalized));
  }, [options, debouncedQuery]);

  const isDisabled = disabled || !uf;
  const placeholder = !uf
    ? "Selecione a UF"
    : loading
      ? "Carregando municipios..."
      : "Selecione o municipio";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label="Selecionar municipio"
          disabled={isDisabled}
          className="h-11 w-full justify-between px-3 text-left font-normal sm:h-9"
        >
          <span className="truncate text-sm">{value || placeholder}</span>
          <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="z-[70] w-[var(--radix-popover-trigger-width)] p-0"
      >
        <Command shouldFilter={false}>
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder={uf ? "Buscar municipio..." : "Selecione a UF primeiro"}
            inputMode="search"
            enterKeyHint="search"
            autoCorrect="off"
            autoCapitalize="words"
            spellCheck={false}
            disabled={!uf}
            className="h-11 text-base sm:h-10 sm:text-sm"
          />
          <CommandList className="max-h-[45vh] touch-pan-y overscroll-contain sm:max-h-72">
            {loading ? (
              <div className="flex items-center gap-2 px-3 py-4 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                <span>Carregando municipios...</span>
              </div>
            ) : null}
            {!loading ? (
              <CommandEmpty>Nenhum municipio encontrado.</CommandEmpty>
            ) : null}
            <CommandGroup>
              {filteredOptions.map((name) => (
                <CommandItem
                  key={name}
                  value={name}
                  onSelect={() => {
                    onChange(name);
                    setOpen(false);
                  }}
                  className="min-h-11 text-sm sm:min-h-9"
                >
                  <Check
                    className={cn(
                      "mr-2 size-4",
                      value === name ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <span className="truncate">{name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

