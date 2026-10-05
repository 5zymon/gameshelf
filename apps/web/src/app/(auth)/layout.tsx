export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="relative w-full max-w-sm">
        <span
          className="absolute -left-3 top-0 h-full w-1 rounded-full bg-accent"
          aria-hidden="true"
        />
        {children}
      </div>
    </div>
  );
}
