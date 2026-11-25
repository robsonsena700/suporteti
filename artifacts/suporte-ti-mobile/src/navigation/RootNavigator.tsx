import React from "react";
import { ActivityIndicator, Button, Text, View } from "react-native";
import { NavigationContainer, type CompositeScreenProps } from "@react-navigation/native";
import { createNativeStackNavigator, type NativeStackScreenProps } from "@react-navigation/native-stack";
import { createBottomTabNavigator, type BottomTabScreenProps } from "@react-navigation/bottom-tabs";
import { Ionicons } from "@expo/vector-icons";

import { colors } from "../theme";
import { useAuth } from "../lib/auth-context";
import LoginScreen from "../screens/LoginScreen";
import ForgotPasswordScreen from "../screens/ForgotPasswordScreen";
import RegisterScreen from "../screens/RegisterScreen";
import PendingScreen from "../screens/PendingScreen";
import DashboardScreen from "../screens/DashboardScreen";
import TicketsScreen from "../screens/TicketsScreen";
import TicketDetailScreen from "../screens/TicketDetailScreen";
import NewTicketScreen from "../screens/NewTicketScreen";

export type MainTabParamList = {
  Dashboard: undefined;
  Tickets: { initialFilter?: "mine" | "noCoordinator" } | undefined;
};

export type RootStackParamList = {
  Login: undefined;
  ForgotPassword: undefined;
  Register: undefined;
  Pending: undefined;
  Main: undefined;
  TicketDetail: { ticketId: number };
  NewTicket: undefined;
};

export type DashboardScreenProps = CompositeScreenProps<
  BottomTabScreenProps<MainTabParamList, "Dashboard">,
  NativeStackScreenProps<RootStackParamList>
>;
export type TicketsScreenProps = CompositeScreenProps<
  BottomTabScreenProps<MainTabParamList, "Tickets">,
  NativeStackScreenProps<RootStackParamList>
>;
export type TicketDetailScreenProps = NativeStackScreenProps<RootStackParamList, "TicketDetail">;
export type NewTicketScreenProps = NativeStackScreenProps<RootStackParamList, "NewTicket">;
export type LoginScreenProps = NativeStackScreenProps<RootStackParamList, "Login">;
export type ForgotPasswordScreenProps = NativeStackScreenProps<RootStackParamList, "ForgotPassword">;
export type RegisterScreenProps = NativeStackScreenProps<RootStackParamList, "Register">;
export type PendingScreenProps = NativeStackScreenProps<RootStackParamList, "Pending">;

const RootStack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<MainTabParamList>();

function LoadingScreen() {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
      <ActivityIndicator size="large" />
    </View>
  );
}

// Mesma logica do RouteConnectionErrorState em App.tsx do app web: distingue
// falha de conexao/timeout (sessao pode ainda ser valida) de token invalido.
function ConnectionErrorScreen({ onRetry }: { onRetry: () => void }) {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 16 }}>
      <Text style={{ textAlign: "center" }}>
        Nao foi possivel confirmar sua sessao. Verifique sua conexao com a internet e tente
        novamente.
      </Text>
      <Button title="Tentar novamente" onPress={onRetry} />
    </View>
  );
}

function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textSecondary,
      }}
    >
      <Tab.Screen
        name="Dashboard"
        component={DashboardScreen}
        options={{
          title: "Início",
          tabBarIcon: ({ color, size }) => <Ionicons name="home-outline" size={size} color={color} />,
        }}
      />
      <Tab.Screen
        name="Tickets"
        component={TicketsScreen}
        options={{
          title: "Chamados",
          tabBarIcon: ({ color, size }) => <Ionicons name="ticket-outline" size={size} color={color} />,
        }}
      />
    </Tab.Navigator>
  );
}

export function RootNavigator() {
  const { user, isLoading, isConnectionError, retry } = useAuth();

  if (isLoading) return <LoadingScreen />;
  if (isConnectionError) return <ConnectionErrorScreen onRetry={retry} />;

  return (
    <NavigationContainer>
      <RootStack.Navigator screenOptions={{ headerTitleAlign: "center" }}>
        {!user ? (
          <>
            <RootStack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
            <RootStack.Screen
              name="ForgotPassword"
              component={ForgotPasswordScreen}
              options={{ title: "Recuperar senha" }}
            />
            <RootStack.Screen
              name="Register"
              component={RegisterScreen}
              options={{ title: "Solicitar Acesso" }}
            />
          </>
        ) : user.status === "PENDING" ? (
          // Mesma regra do app web (App.tsx: ProtectedRoute redireciona pra
          // /pendente quando user.status === "PENDING") - sem isso, uma
          // conta ainda nao aprovada entrava direto no Dashboard/Chamados.
          <RootStack.Screen name="Pending" component={PendingScreen} options={{ headerShown: false }} />
        ) : (
          <>
            <RootStack.Screen name="Main" component={MainTabs} options={{ headerShown: false }} />
            <RootStack.Screen
              name="TicketDetail"
              component={TicketDetailScreen}
              options={{ title: "Chamado" }}
            />
            <RootStack.Screen
              name="NewTicket"
              component={NewTicketScreen}
              options={{ title: "Novo chamado" }}
            />
          </>
        )}
      </RootStack.Navigator>
    </NavigationContainer>
  );
}
