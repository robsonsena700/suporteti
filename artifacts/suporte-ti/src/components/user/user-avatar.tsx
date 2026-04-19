import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { useUserAvatarDataUrl } from "@/lib/use-user-avatar";

export function UserAvatar({
  userId,
  name,
  className,
}: {
  userId: number | null | undefined;
  name: string;
  className?: string;
}) {
  const { data: src } = useUserAvatarDataUrl(userId);
  const initials = name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map(p => p[0]?.toUpperCase())
    .join("");

  return (
    <Avatar className={cn("h-8 w-8", className)}>
      {src ? <AvatarImage src={src} alt={name} /> : null}
      <AvatarFallback>{initials || "U"}</AvatarFallback>
    </Avatar>
  );
}

