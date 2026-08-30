import {
  ArrowRight,
  History,
  Key,
  Lock,
  MessageSquareText,
  Timer,
} from "../components/icons";
import { Button } from "../components/ui/button";
import { Textarea } from "../components/ui/textarea";

type LoginPageProps = {
  token: string;
  error: string | null;
  isSubmitting: boolean;
  onTokenChange: (token: string) => void;
  onSubmit: () => void;
};

const features = [
  {
    icon: MessageSquareText,
    title: "Remote Chat",
    desc: "按桌面端式样查看 token、thinking、tool_call 与 tool_result。",
  },
  {
    icon: History,
    title: "History Resume",
    desc: "从远程历史回填会话并继续对话，而不是只看原始 JSON。",
  },
  {
    icon: Timer,
    title: "Cron Control",
    desc: "在浏览器里完成任务查看、创建、更新与删除的转发调试。",
  },
];

export function LoginPage({ token, error, isSubmitting, onTokenChange, onSubmit }: LoginPageProps) {
  return (
    <main className="relative flex min-h-screen w-full items-center justify-center overflow-hidden bg-background p-4 sm:p-6 md:p-10">
      {/* Subtle ambient gradient backdrop */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        <div className="absolute -top-32 -left-32 h-[450px] w-[450px] rounded-full bg-primary/[0.06] blur-[100px]" />
        <div className="absolute -bottom-32 -right-32 h-[450px] w-[450px] rounded-full bg-primary/[0.06] blur-[100px]" />
      </div>

      <div className="relative grid w-full max-w-4xl grid-cols-1 overflow-hidden rounded-3xl border border-border/70 bg-card shadow-2xl backdrop-blur-xl md:grid-cols-5">
        {/* Left: branding + features */}
        <div className="flex flex-col justify-between border-b border-border/60 bg-muted/20 p-8 md:col-span-2 md:border-b-0 md:border-r">
          <div>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border/60 bg-foreground/[0.04] p-1.5 shadow-xs">
                <img src="/icon-simple.png" alt="Agent" className="h-full w-full object-contain" draggable={false} />
              </div>
              <h1 className="text-base font-semibold tracking-tight text-foreground">Agent Gateway</h1>
            </div>
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
              安全连接到远程代理会话，在浏览器中获得完整的控制台体验。
            </p>
          </div>

          <div className="my-8 space-y-4">
            {features.map((f) => (
              <div key={f.title} className="flex items-start gap-3">
                <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-border/50 bg-background text-foreground/80 shadow-xs">
                  <f.icon className="h-3.5 w-3.5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold text-foreground/90">{f.title}</div>
                  <div className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{f.desc}</div>
                </div>
              </div>
            ))}
          </div>

          <div className="text-[11px] text-muted-foreground/60">
            Powered by Agent Gateway Service
          </div>
        </div>

        {/* Right: auth form */}
        <div className="flex flex-col justify-center p-8 sm:p-10 md:col-span-3">
          <div className="mb-6">
            <div className="flex items-center gap-2 text-base font-semibold text-foreground">
              <Lock className="h-4 w-4 text-muted-foreground" />
              <h2>连接控制台</h2>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              输入 Gateway 服务端的 Access Token 以验证身份
            </p>
          </div>

          <div className="space-y-2">
            <label htmlFor="access-token" className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Key className="h-3 w-3" />
              <span>Access Token</span>
            </label>
            <Textarea
              id="access-token"
              name="access_token"
              rows={4}
              value={token}
              placeholder="请在此粘贴 Access Token..."
              disabled={isSubmitting}
              aria-invalid={error ? "true" : "false"}
              onChange={(e) => onTokenChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && token.trim() && !isSubmitting) {
                  e.preventDefault();
                  onSubmit();
                }
              }}
              className="resize-none rounded-xl border border-border/70 bg-background/60 font-mono text-xs leading-relaxed transition-colors placeholder:text-muted-foreground/50 focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>

          {error && (
            <p className="mt-2.5 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          )}

          <Button
            type="button"
            size="lg"
            disabled={token.trim() === "" || isSubmitting}
            onClick={onSubmit}
            className="mt-6 h-10 w-full gap-2 rounded-xl text-xs font-medium shadow-xs"
          >
            {isSubmitting ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-background border-t-transparent" />
            ) : (
              <>
                <span>进入 Gateway</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </>
            )}
          </Button>

          <p className="mt-4 text-center text-[11px] text-muted-foreground">
            Token 验证通过后将本地保存，下次自动登录
          </p>
        </div>
      </div>
    </main>
  );
}
