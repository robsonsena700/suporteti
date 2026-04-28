import { useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "./custom-fetch";
import { getGetTicketQueryKey, getGetTicketRatingQueryKey } from "./generated/api";

export type CreateTicketRatingBody = {
  rating: number;
  reason_low_rating?: string;
  comment?: string;
};

export type CreateTicketRatingResponse = {
  id: number;
  ticketId: number;
  rating: number;
  reason_low_rating: string | null;
  comment: string | null;
  created_at: string;
};

export const createTicketRating = async (
  ticketId: number,
  data: CreateTicketRatingBody,
  options?: RequestInit,
): Promise<CreateTicketRatingResponse> => {
  return customFetch<CreateTicketRatingResponse>(`/api/tickets/${ticketId}/rate`, {
    ...options,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(options?.headers ?? {}),
    },
    body: JSON.stringify(data),
  });
};

export function useCreateTicketRating() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (args: { ticketId: number; data: CreateTicketRatingBody }) => createTicketRating(args.ticketId, args.data),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: getGetTicketQueryKey(variables.ticketId) });
      queryClient.invalidateQueries({ queryKey: getGetTicketRatingQueryKey(variables.ticketId) });
      queryClient.invalidateQueries({ queryKey: ["/api/tickets"] });
    },
  });
}
