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
    <section className="w-full max-w-sm rounded-2xl border border-edge bg-shelf p-8 shadow-xl ring-1 ring-white/5">
      <p className="text-xs uppercase tracking-widest text-accent">{eyebrow}</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight text-fog">
        {title}
      </h1>
      {description !== undefined && (
        <p className="mt-1 mb-6 text-sm text-muted">{description}</p>
      )}
      {children}
    </section>
  );
}
