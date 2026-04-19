import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react/custom-fetch";

type AvatarPayload = { mimeType: string; data: string };

export function useUserAvatarDataUrl(userId: number | null | undefined) {
  return useQuery({
    queryKey: ["user-avatar", userId],
    enabled: typeof userId === "number" && userId > 0,
    queryFn: async () => {
      const payload = await customFetch<AvatarPayload>(`/api/users/${userId}/avatar`);
      return `data:${payload.mimeType};base64,${payload.data}`;
    },
    retry: false,
    staleTime: 1000 * 60 * 60,
  });
}

