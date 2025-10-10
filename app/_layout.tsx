// app/_layout.tsx
import React from 'react';
import { Slot } from 'expo-router';
import { BLEProvider } from '@/src/context/BLEContext'; // adjust path if needed

export default function RootLayout() {
    return (
        <BLEProvider>
            <Slot />
        </BLEProvider>
    );
}
