import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useLocation, Link } from "wouter";
import { useCreateTicket, TicketType, TicketPriority } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft } from "lucide-react";

const ticketSchema = z.object({
  title: z.string().min(5, "Título muito curto"),
  description: z.string().min(10, "Descrição muito curta"),
  type: z.nativeEnum(TicketType),
  priority: z.nativeEnum(TicketPriority),
});

type TicketForm = z.infer<typeof ticketSchema>;

export default function NewTicket() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const createMutation = useCreateTicket();

  const form = useForm<TicketForm>({
    resolver: zodResolver(ticketSchema),
    defaultValues: {
      title: "",
      description: "",
      type: TicketType.SOFTWARE,
      priority: TicketPriority.LOW,
    },
  });

  const onSubmit = (data: TicketForm) => {
    createMutation.mutate(
      { data },
      {
        onSuccess: (ticket) => {
          toast({
            title: "Chamado criado com sucesso",
            description: `Protocolo #${ticket.id} gerado.`,
          });
          setLocation(`/chamados/${ticket.id}`);
        },
        onError: () => {
          toast({
            title: "Erro ao criar chamado",
            description: "Tente novamente em instantes.",
            variant: "destructive",
          });
        },
      }
    );
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/chamados">
            <ArrowLeft className="w-5 h-5" />
          </Link>
        </Button>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Novo Chamado</h1>
          <p className="text-muted-foreground mt-1">
            Preencha os dados abaixo para relatar um incidente ou solicitar serviço.
          </p>
        </div>
      </div>

      <Card>
        <CardContent className="pt-6">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <FormField
                control={form.control}
                name="title"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Título resumido</FormLabel>
                    <FormControl>
                      <Input placeholder="Ex: Sistema não abre no Chrome" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-2 gap-6">
                <FormField
                  control={form.control}
                  name="type"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Tipo de Solicitação</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Selecione" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value={TicketType.SOFTWARE}>Software</SelectItem>
                          <SelectItem value={TicketType.HARDWARE}>Hardware</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <FormField
                  control={form.control}
                  name="priority"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Prioridade</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Selecione" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value={TicketPriority.LOW}>Baixa</SelectItem>
                          <SelectItem value={TicketPriority.MEDIUM}>Média</SelectItem>
                          <SelectItem value={TicketPriority.HIGH}>Alta</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Descrição Detalhada</FormLabel>
                    <FormControl>
                      <Textarea 
                        placeholder="Descreva o problema passo a passo..." 
                        className="min-h-[150px] resize-none"
                        {...field} 
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex justify-end gap-4">
                <Button variant="outline" asChild>
                  <Link href="/chamados">Cancelar</Link>
                </Button>
                <Button type="submit" disabled={createMutation.isPending}>
                  {createMutation.isPending ? "Salvando..." : "Abrir Chamado"}
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
