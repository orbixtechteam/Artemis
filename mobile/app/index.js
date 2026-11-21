import React, { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { newChatId } from '../src/lib/core';
import { useSession } from '../src/lib/session';
import { Home } from '../src/components/Home';

let launched = false; // the app opens on a new chat once; Back from it is the home page

/** Start: the home page (everything the desktop sidebar has) when this device is paired, otherwise the connect screen. */
export default function Index() {
  const { ready, server, c } = useSession();
  const router = useRouter();
  useEffect(() => {
    if (ready && server && !launched) { launched = true; router.push(`/chat/${newChatId()}?fresh=1`); }
  }, [ready, server]);
  if (!ready) return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: c.bg }}><ActivityIndicator color={c.muted} /></View>;
  if (!server) return <Redirect href="/connect" />;
  return <Home />;
}
