import { XdrNav, XdrThemeStyles } from "@/components/xdreamer/shared";

/**
 * (main) layout — wraps all authenticated app routes (generate, gallery,
 * pricing, profile, referral) with the X-DREAMER nav + theme tokens.
 *
 * The fiber-threads ambient bg is mounted once in the root layout via
 * AmbientBackground, so we don't render it again here.
 *
 * Note: replaced legacy `<Navbar />` + `<MobileNav />` with `XdrNav`.
 * X-DREAMER's nav stacks vertically on mobile via the responsive CSS
 * shipped by XdrThemeStyles.
 */
export default function MainLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen text-foreground">
      <XdrThemeStyles />
      <XdrNav />
      <main className="flex-1 pt-20 pb-16">{children}</main>
    </div>
  );
}
