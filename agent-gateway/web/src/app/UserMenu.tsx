import { AgentMark } from "@/components/brand/AgentMark";
import { ChevronDown, LogOut, MoreHorizontal, Settings, User } from "@/components/icons";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/shared/utils";
import type { SectionId } from "@/pages/settings/types";

type UserMenuProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userMenuLabel: string;
  userAvatarLabel: string;
  sessionId?: string | null;
  onLogout: () => void;
  onOpenSettings?: (section?: SectionId) => void;
  sidebar?: boolean;
};

export function UserMenu(props: UserMenuProps) {
  const {
    open,
    onOpenChange,
    userMenuLabel,
    userAvatarLabel,
    sessionId,
    onLogout,
    onOpenSettings,
    sidebar,
  } = props;

  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            className={cn(
              "h-8 gap-1 rounded-full border border-border/60 bg-background/70 px-1.5 text-foreground shadow-sm hover:bg-muted/70",
              sidebar &&
                "gateway-sidebar-account-trigger h-10 w-full justify-start gap-2 rounded-lg border-0 bg-transparent px-2 hover:bg-foreground/[0.07]",
            )}
            title="用户菜单"
          >
            {sidebar ? (
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-foreground text-background">
                <AgentMark className="h-4 w-4" />
              </span>
            ) : (
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500/90 to-sky-500/90 text-[calc(11px*var(--zone-font-scale,1))] font-semibold text-white">
                {userAvatarLabel || <User className="h-3.5 w-3.5" />}
              </span>
            )}
            {sidebar ? (
              <span className="min-w-0 flex-1 truncate text-left text-sm font-medium">Agent</span>
            ) : null}
            {sidebar ? (
              <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            )}
          </Button>
        }
      />
      <DropdownMenuContent
        align={sidebar ? "start" : "end"}
        side={sidebar ? "top" : "bottom"}
        sideOffset={8}
        className="min-w-[12rem] rounded-xl border-border/70 bg-popover/95 backdrop-blur supports-[backdrop-filter]:bg-popover/90"
      >
        <DropdownMenuLabel className="px-3 py-2">
          <div className="text-sm font-medium text-foreground">{userMenuLabel}</div>
          <div className="mt-0.5 text-xs font-normal text-muted-foreground">
            Session {sessionId || "N/A"}
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {sidebar && onOpenSettings ? (
          <DropdownMenuItem onSelect={() => onOpenSettings()} className="gap-2">
            <Settings className="h-3.5 w-3.5" />
            设置
          </DropdownMenuItem>
        ) : null}
        {sidebar && onOpenSettings ? <DropdownMenuSeparator /> : null}
        <DropdownMenuItem
          onSelect={onLogout}
          className="gap-2 text-destructive focus:bg-destructive/10 focus:text-destructive"
        >
          <LogOut className="h-3.5 w-3.5" />
          退出登录
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
