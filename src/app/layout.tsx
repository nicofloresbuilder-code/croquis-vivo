import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Croquis Vivo",
  description:
    "Dibuja el croquis de tu escuela, hospital o casa, activa la alarma y mira dónde falla el simulacro: quién no la escucha, qué estorbo bloquea la ruta y dónde se hace la fila.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700;800&family=Martian+Mono:wght@400;500;600&display=swap"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
