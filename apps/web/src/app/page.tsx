export default function HomePage(): React.ReactElement {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

  return (
    <main>
      <h1>GameShelf</h1>
      <p>Track, organize, and discover your video game library.</p>
      <p>
        API: <code>{apiUrl}</code>
      </p>
    </main>
  );
}
