import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import BackgroundLogo from "../../components/BackgroundLogo";
import CalendarPickerModal from "../../components/CalendarPickerModal";
import DailyPlanStopEditor from "../../components/DailyPlanStopEditor";
import DailyPlanLegCard from "../../components/DailyPlanLegCard";
import DetailHeader from "../../components/DetailHeader";
import { Colors } from "../../constants/Colors";
import { useAuth } from "../../context/AuthContext";
import { useLiveData } from "../../context/LiveDataContext";
import { api } from "../../services/api";
import { schedulePlanReminders } from "../../services/dailyPlanNotifications";
import { loadDailyPlan, saveDailyPlan, validateDailyPlanDraft } from "../../services/dailyPlans";
import { currentPlannerLocation } from "../../services/telemetryNative";
import { showTestHighPriorityNotification } from "../../services/telemetryNative";
import type { DailyPlan } from "../../services/types";

const localDate = () => {
  const date = new Date();
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
};

const DailyPlannerScreen: React.FC = () => {
  const { token } = useAuth();
  const { latestSoc } = useLiveData();
  const [message, setMessage] = useState("");
  const [serviceDate, setServiceDate] = useState(localDate());
  const [startingSoc, setStartingSoc] = useState(
    latestSoc == null ? "" : String(latestSoc)
  );
  const [reply, setReply] = useState<string | null>(null);
  const [plan, setPlan] = useState<DailyPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reminderStatus, setReminderStatus] = useState<string | null>(null);
  const [calendarOpen, setCalendarOpen] = useState(false);

  const testNotification = async () => {
    setError(null);
    try {
      await showTestHighPriorityNotification();
      setReminderStatus("Test notification sent. Confirm it appeared in the Android notification tray.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not show a test notification.");
    }
  };

  useEffect(() => {
    loadDailyPlan().then(setPlan).catch(() => undefined);
  }, []);

  const validation = useMemo(
    () => (plan ? validateDailyPlanDraft(plan.draft) : null),
    [plan]
  );

  const createDraft = async () => {
    const soc = Number(startingSoc);
    if (!token || !message.trim()) return;
    if (!Number.isFinite(soc) || soc < 0 || soc > 100) {
      setError("Enter the current SOC from 0 to 100.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await api.createDailyPlanDraft(token, {
        message: message.trim(),
        service_date: serviceDate,
        timezone: "Asia/Kolkata",
        starting_soc_pct: soc,
      });
      setReply(response.conversation.reply);
      setPlan(response.plan);
      await saveDailyPlan(response.plan);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create the daily plan.");
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!token || !plan || !validation?.valid) return;
    setBusy(true);
    setError(null);
    setReminderStatus(null);
    try {
      const origin = await currentPlannerLocation();
      const confirmed = await api.confirmDailyPlan(token, plan.id, {
        confirmation_key: `daily-plan-confirm-${plan.id}`,
        origin,
        stops: plan.draft.stops.map(stop => ({
          label: stop.label.trim(),
          requested_arrival_local: stop.requested_arrival_local,
          coordinates: stop.coordinates,
        })),
      });
      setPlan(confirmed);
      await saveDailyPlan(confirmed);
      await scheduleReminders(confirmed);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not confirm the daily plan.");
    } finally {
      setBusy(false);
    }
  };

  const scheduleReminders = async (confirmedPlan = plan) => {
    if (!confirmedPlan) return;
    setBusy(true);
    setError(null);
    try {
      const reminders = await schedulePlanReminders(confirmedPlan);
      setReminderStatus(
        `${reminders.scheduled} high-priority departure reminder${reminders.scheduled === 1 ? "" : "s"} scheduled on this phone${reminders.skipped ? `; ${reminders.skipped} expired reminder${reminders.skipped === 1 ? " was" : "s were"} skipped` : ""}.`
      );
    } catch (caught) {
      setReminderStatus(null);
      setError(caught instanceof Error ? caught.message : "Could not schedule departure reminders.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.container}>
      <BackgroundLogo />
      <DetailHeader title="Plan My Day" subtitle="AI conversation, verified route and SOC tools" />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.assistantBubble}>
            <Text style={styles.assistantText}>
              Tell me every stop and arrival time for the day. Example: Office at 9 am, client at 12:30 pm, warehouse at 4 pm, home by 7 pm.
            </Text>
          </View>
          <TextInput
            style={[styles.input, styles.messageInput]}
            value={message}
            onChangeText={setMessage}
            placeholder="Enter today's full schedule"
            placeholderTextColor={Colors.secondaryText}
            multiline
            maxLength={2000}
          />
          <View style={styles.inputRow}>
            <TouchableOpacity style={[styles.input, styles.half, styles.dateButton]} onPress={() => setCalendarOpen(true)}>
              <Text style={styles.dateLabel}>Plan date</Text>
              <Text style={styles.dateValue}>{serviceDate}</Text>
            </TouchableOpacity>
            <TextInput style={[styles.input, styles.half]} value={startingSoc} onChangeText={setStartingSoc} placeholder="Current SOC %" placeholderTextColor={Colors.secondaryText} keyboardType="decimal-pad" />
          </View>
          <TouchableOpacity style={styles.primaryButton} disabled={busy} onPress={createDraft}>
            {busy ? <ActivityIndicator color={Colors.darkText} /> : <Text style={styles.primaryText}>Ask AI to structure my day</Text>}
          </TouchableOpacity>
          <TouchableOpacity style={styles.testButton} disabled={busy} onPress={testNotification}>
            <Text style={styles.testButtonText}>Send a test notification now</Text>
          </TouchableOpacity>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          {reply ? <View style={styles.assistantBubble}><Text style={styles.assistantText}>{reply}</Text></View> : null}
          {plan ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>{plan.status === "confirmed" ? "Today's prediction" : "Confirm these stops"}</Text>
              {plan.status === "confirmed" ? plan.draft.stops.map((stop, index) => (
                <View key={`${stop.label}-${index}`} style={styles.stopRow}>
                  <Text style={styles.stopName}>{index + 1}. {stop.label}</Text>
                  <Text style={styles.stopTime}>{stop.requested_arrival_local || "Time needed"}</Text>
                </View>
              )) : <DailyPlanStopEditor
                stops={plan.draft.stops}
                onChange={stops => setPlan(current => current ? ({
                  ...current,
                  draft: { ...current.draft, stops, warnings: [] },
                }) : current)}
                onSelectMap={() => setError("Move the map pin to choose this stop in the next screen.")}
              />}
              {validation?.reason ? <Text style={styles.warning}>{validation.reason} Edit the message and ask again.</Text> : null}
              {plan.status !== "confirmed" && validation?.valid ? (
                <TouchableOpacity style={styles.confirmButton} disabled={busy} onPress={confirm}>
                  <Text style={styles.confirmText}>Confirm, predict SOC and schedule alerts</Text>
                </TouchableOpacity>
              ) : null}
              {plan.status === "confirmed" && !reminderStatus ? (
                <TouchableOpacity style={styles.confirmButton} disabled={busy} onPress={() => scheduleReminders()}>
                  <Text style={styles.confirmText}>Schedule high-priority reminders</Text>
                </TouchableOpacity>
              ) : null}
              {reminderStatus ? <Text style={styles.success}>{reminderStatus}</Text> : null}
              {plan.result?.legs.map((leg) => <DailyPlanLegCard key={leg.index} leg={leg} />)}
              {plan.result ? <Text style={styles.disclaimer}>SOC is an estimate from the latest GPS prediction when available, otherwise the vehicle specification baseline. Traffic and chargers show their source; place listings do not prove live availability.</Text> : null}
            </View>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
      <CalendarPickerModal visible={calendarOpen} value={serviceDate} today={localDate()} onSelect={setServiceDate} onClose={() => setCalendarOpen(false)} />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.appBackground },
  flex: { flex: 1 },
  content: { padding: 16, gap: 12, paddingBottom: 50 },
  assistantBubble: { alignSelf: "flex-start", maxWidth: "92%", backgroundColor: "rgba(0,229,255,0.09)", borderColor: "rgba(0,229,255,0.28)", borderWidth: 1, borderRadius: 16, borderBottomLeftRadius: 4, padding: 14 },
  assistantText: { color: Colors.primaryText, lineHeight: 20, fontSize: 14 },
  input: { backgroundColor: Colors.premiumCardBg, color: Colors.white, borderWidth: 1, borderColor: Colors.premiumCardBorder, borderRadius: 13, paddingHorizontal: 14, paddingVertical: 12 },
  messageInput: { minHeight: 100, textAlignVertical: "top" },
  inputRow: { flexDirection: "row", gap: 10 },
  half: { flex: 1 },
  dateButton: { justifyContent: "center" },
  dateLabel: { color: Colors.secondaryText, fontSize: 10 },
  dateValue: { color: Colors.white, fontWeight: "800", marginTop: 2 },
  primaryButton: { minHeight: 50, borderRadius: 14, backgroundColor: Colors.trickeeYellow, alignItems: "center", justifyContent: "center", padding: 10 },
  primaryText: { color: Colors.darkText, fontWeight: "900" },
  testButton: { minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: Colors.neonBlue, alignItems: "center", justifyContent: "center", padding: 10 },
  testButtonText: { color: Colors.neonBlue, fontWeight: "800" },
  section: { gap: 11, marginTop: 8 },
  sectionTitle: { color: Colors.white, fontSize: 20, fontWeight: "900" },
  stopRow: { flexDirection: "row", padding: 13, borderRadius: 12, backgroundColor: Colors.premiumCardBg },
  stopName: { flex: 1, color: Colors.white, fontWeight: "700" },
  stopTime: { color: Colors.trickeeYellow, fontWeight: "800" },
  confirmButton: { minHeight: 50, borderRadius: 14, borderWidth: 1, borderColor: Colors.greenAccent, alignItems: "center", justifyContent: "center", padding: 10 },
  confirmText: { color: Colors.greenAccent, fontWeight: "900" },
  warning: { color: Colors.trickeeYellow, lineHeight: 18 },
  error: { color: Colors.redSoft, backgroundColor: "rgba(255,68,68,0.09)", borderRadius: 10, padding: 12 },
  success: { color: Colors.greenAccent, lineHeight: 18 },
  disclaimer: { color: Colors.secondaryText, fontSize: 11, lineHeight: 17 },
});

export default DailyPlannerScreen;
