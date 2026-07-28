/**
 * Trickee GPS-First EV Intelligence — App Entry Point
 */
import React from "react";
import { StatusBar } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider } from "./src/context/AuthContext";
import { LiveDataProvider } from "./src/context/LiveDataContext";
import AppNavigator from "./src/navigation/AppNavigator";
import AppErrorBoundary from "./src/components/AppErrorBoundary";

const App: React.FC = () => (
  <GestureHandlerRootView style={{ flex: 1 }}>
    <SafeAreaProvider>
      <AuthProvider>
        <AppErrorBoundary>
          <LiveDataProvider>
            <StatusBar
              translucent
              backgroundColor="transparent"
              barStyle="light-content"
            />
            <AppNavigator />
          </LiveDataProvider>
        </AppErrorBoundary>
      </AuthProvider>
    </SafeAreaProvider>
  </GestureHandlerRootView>
);

export default App;
