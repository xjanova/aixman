import { Navbar } from "@/components/layout/navbar";

export default function MainLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background bg-dots">
      <Navbar />
      <main className="flex-1">{children}</main>
    </div>
  );
}
