import { 
  useGetTicketsByStatus, 
  useGetTicketsByRegion, 
  useGetTicketsByType,
  getGetTicketsByStatusQueryKey,
  getGetTicketsByRegionQueryKey,
  getGetTicketsByTypeQueryKey
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend, BarChart, Bar, XAxis, YAxis, CartesianGrid } from "recharts";

const COLORS = ['#1B3B6E', '#2B5B9E', '#3B7BCE', '#4B9BFE', '#5BBBFE'];

export default function Reports() {
  const { data: statusData, isLoading: isLoadingStatus } = useGetTicketsByStatus({
    query: { queryKey: getGetTicketsByStatusQueryKey() }
  });

  const { data: regionData, isLoading: isLoadingRegion } = useGetTicketsByRegion({
    query: { queryKey: getGetTicketsByRegionQueryKey() }
  });

  const { data: typeData, isLoading: isLoadingType } = useGetTicketsByType({
    query: { queryKey: getGetTicketsByTypeQueryKey() }
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Relatórios Gerenciais</h1>
        <p className="text-muted-foreground mt-1">
          Análise de desempenho e distribuição de chamados.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="flex flex-col">
          <CardHeader>
            <CardTitle>Chamados por Status</CardTitle>
          </CardHeader>
          <CardContent className="flex-1 flex min-h-[300px]">
            {isLoadingStatus ? (
              <div className="flex-1 flex items-center justify-center">Carregando...</div>
            ) : statusData && statusData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={statusData}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    outerRadius={100}
                    fill="#8884d8"
                    dataKey="count"
                    nameKey="status"
                    label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                  >
                    {statusData.map((_, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex-1 flex items-center justify-center text-muted-foreground">Sem dados suficientes</div>
            )}
          </CardContent>
        </Card>

        <Card className="flex flex-col">
          <CardHeader>
            <CardTitle>Chamados por Tipo</CardTitle>
          </CardHeader>
          <CardContent className="flex-1 flex min-h-[300px]">
            {isLoadingType ? (
              <div className="flex-1 flex items-center justify-center">Carregando...</div>
            ) : typeData && typeData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={typeData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    fill="#8884d8"
                    dataKey="count"
                    nameKey="type"
                    label
                  >
                    {typeData.map((_, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[(index + 2) % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex-1 flex items-center justify-center text-muted-foreground">Sem dados suficientes</div>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2 flex flex-col">
          <CardHeader>
            <CardTitle>Chamados por Região (UF)</CardTitle>
          </CardHeader>
          <CardContent className="flex-1 min-h-[350px]">
            {isLoadingRegion ? (
              <div className="h-full flex items-center justify-center">Carregando...</div>
            ) : regionData && regionData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={regionData}
                  margin={{ top: 20, right: 30, left: 20, bottom: 5 }}
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="uf" />
                  <YAxis allowDecimals={false} />
                  <Tooltip cursor={{fill: 'transparent'}} />
                  <Bar dataKey="count" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} name="Quantidade" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-muted-foreground">Sem dados suficientes</div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
