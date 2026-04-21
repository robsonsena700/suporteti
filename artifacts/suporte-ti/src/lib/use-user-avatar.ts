import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react/custom-fetch";
import { ApiError } from "@workspace/api-client-react/custom-fetch";

type AvatarPayload = { mimeType: string; data: string };

export function useUserAvatarDataUrl(userId: number | null | undefined) {
  return useQuery({
    queryKey: ["user-avatar", userId],
    enabled: typeof userId === "number" && userId > 0,
    queryFn: async () => {
      try {
        const payload = await customFetch<AvatarPayload | null>(`/api/users/${userId}/avatar`);
        if (!payload) return null;
        return `data:${payload.mimeType};base64,${payload.data}`;
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) return null;
        throw e;
      }
    },
    retry: false,
    staleTime: 1000 * 60 * 60,
  });
}

