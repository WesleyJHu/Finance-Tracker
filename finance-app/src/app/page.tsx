// app/about/page.tsx

import React from 'react';
import Card from '../components/AccountCard';
import TestTransactionApiButton from '@/components/TestTransactionApiButton';
import TestAccountApiButton from '@/components/TestAccountApiButton';

export default function AboutPage() {
  return (
    <main className="p-8">
      <h1 className="text-3xl font-bold mb-4">Hi</h1>
      <Card name="Fidelity Credit Card" limit={6500} value={4200} />
      <TestTransactionApiButton />
      <TestAccountApiButton />
    </main>
  );
}