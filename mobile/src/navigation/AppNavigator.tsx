import React, { useCallback, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import {
  createNavigationContainerRef,
  NavigationContainer,
} from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { useAuth } from "../context/AuthContext";
import { Colors } from "../constants/Colors";
import LiquidGlassTabBar from "../components/LiquidGlassTabBar";
import LoginScreen from "../screens/auth/LoginScreen";
import HomeScreen from "../screens/home/HomeScreen";
import LiveMapScreen from "../screens/home/LiveMapScreen";
import MonitoringScreen from "../screens/home/MonitoringScreen";
import MoreMenuScreen from "../screens/home/MoreMenuScreen";
import VehicleOnboardingScreen from "../screens/VehicleOnboardingScreen";
import AIAssistantScreen from "../screens/detail/AIAssistantScreen";
import RouteIntelScreen from "../screens/detail/RouteIntelScreen";
import PastTripsScreen from "../screens/detail/PastTripsScreen";
import DailyImpactScreen from "../screens/detail/DailyImpactScreen";
import RouteNudgesScreen from "../screens/detail/RouteNudgesScreen";
import DailyPlannerScreen from "../screens/detail/DailyPlannerScreen";
import AppHeader from "../components/AppHeader";
import SideDrawer from "../components/SideDrawer";
import OwnerDashboardScreen from "../screens/owner/OwnerDashboardScreen";

const RootStack = createNativeStackNavigator();
const AuthStack = createNativeStackNavigator();
const MainTab = createBottomTabNavigator();
const navigationRef = createNavigationContainerRef<any>();

function AuthNavigator() {
  return (
    <AuthStack.Navigator screenOptions={{ headerShown: false }}>
      <AuthStack.Screen name="Login" component={LoginScreen} />
    </AuthStack.Navigator>
  );
}

function MainTabBar({ props, drawerOpen, setDrawerOpen, rootNavigation }: any) {
  const navigateFromDrawer = (route: string) => {
    if (["Home", "Live Map", "Monitoring"].includes(route)) {
      props.navigation.navigate(route);
    } else {
      rootNavigation.navigate(route);
    }
  };
  return (
    <>
      <LiquidGlassTabBar {...props} />
      <SideDrawer
        visible={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onNavigate={navigateFromDrawer}
      />
    </>
  );
}

function MainTabs({ navigation }: any) {
  const { logout } = useAuth();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const navigateFromMore = (item: string) => {
    const routes: Record<string, string> = {
      aiIntel: "AIAssistant",
      routeIntel: "RouteIntel",
      pastTrips: "PastTrips",
      dailyImpact: "DailyImpact",
    };
    if (routes[item]) {
      navigation.navigate(routes[item]);
    }
  };
  const renderTabBar = useCallback(
    (props: any) => (
      <MainTabBar
        props={props}
        drawerOpen={drawerOpen}
        setDrawerOpen={setDrawerOpen}
        rootNavigation={navigation}
      />
    ),
    [drawerOpen, navigation]
  );
  return (
    <View style={styles.container}>
      <AppHeader onMenu={() => setDrawerOpen(true)} />
      <MainTab.Navigator
        tabBar={renderTabBar}
        screenOptions={{ headerShown: false }}
      >
        <MainTab.Screen name="Home" component={HomeScreen} />
        <MainTab.Screen name="Live Map" component={LiveMapScreen} />
        <MainTab.Screen name="Monitoring" component={MonitoringScreen} />
        <MainTab.Screen name="More">
          {() => (
            <MoreMenuScreen
              onNavigate={navigateFromMore}
              onLogout={logout}
            />
          )}
        </MainTab.Screen>
      </MainTab.Navigator>
    </View>
  );
}

export default function AppNavigator() {
  const { token, user, loading } = useAuth();
  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={Colors.accent} />
      </View>
    );
  }
  const isOwner =
    user?.role === "owner" ||
    user?.role === "fleet_admin" ||
    user?.role === "admin";
  return (
    <NavigationContainer ref={navigationRef}>
      <RootStack.Navigator
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: Colors.appBackground },
        }}
      >
        {token ? (
          <>
            <RootStack.Screen
              name="Main"
              component={isOwner ? OwnerDashboardScreen : MainTabs}
            />
            <RootStack.Group screenOptions={{ animation: "slide_from_right" }}>
              <RootStack.Screen
                name="AIAssistant"
                component={AIAssistantScreen}
              />
              <RootStack.Screen
                name="RouteIntel"
                component={RouteIntelScreen}
              />
              <RootStack.Screen name="PastTrips" component={PastTripsScreen} />
              <RootStack.Screen
                name="DailyImpact"
                component={DailyImpactScreen}
              />
              <RootStack.Screen
                name="RouteNudges"
                component={RouteNudgesScreen}
              />
              <RootStack.Screen
                name="DailyPlanner"
                component={DailyPlannerScreen}
              />
              <RootStack.Screen
                name="VehicleOnboarding"
                component={VehicleOnboardingScreen}
              />
            </RootStack.Group>
          </>
        ) : (
          <RootStack.Screen name="Auth" component={AuthNavigator} />
        )}
      </RootStack.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.appBackground },
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.appBackground,
  },
});
