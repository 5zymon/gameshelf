interface AuthCardProps {
  eyebrow: string;
  title: string;
  description?: string;
  children: React.ReactNode;
}

export function AuthCard({
  eyebrow,
  title,
  description,
  children,
}: AuthCardProps): React.ReactElement {
  return (
    <section className="w-full max-w-sm rounded-card border border-edge bg-surface p-8 shadow-[var(--shadow-card)]">
      <p className="text-xs font-medium tracking-widest text-accent-text uppercase">
        {eyebrow}
      </p>
      <h1 className="mt-2 text-2xl font-bold tracking-[-0.02em] text-ink">
        {title}
      </h1>
      {description !== undefined && (
        <p className="mt-1 mb-6 text-sm text-muted">{description}</p>
      )}
      {children}
    </section>
  );
}
