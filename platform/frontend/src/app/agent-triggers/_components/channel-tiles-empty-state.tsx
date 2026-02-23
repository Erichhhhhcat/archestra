import { Hash } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export function ChannelTilesEmptyState() {
  return (
    <Card>
      <CardContent className="py-10 flex flex-col items-center gap-3">
        <Hash className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          No channels discovered yet
        </p>
        <p className="text-xs text-muted-foreground">
          Send a message to the bot to trigger channel discovery
        </p>
      </CardContent>
    </Card>
  );
}
