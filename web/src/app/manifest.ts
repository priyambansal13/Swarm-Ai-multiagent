import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'SwarmAI — personal assistant',
    short_name: 'SwarmAI',
    description: 'Multi-agent personal assistant: email, calendar, research, travel, money, notes and reminders.',
    start_url: '/',
    display: 'standalone',
    background_color: '#f6f4ee',
    theme_color: '#1b1d1f',
    orientation: 'portrait',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
