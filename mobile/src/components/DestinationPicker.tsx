import React from "react";
import { ActivityIndicator, Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { Colors } from "../constants/Colors";
import { manualDestinationTextChanged, type TripDestination } from "../services/tripStart";
import VoiceInputButton from "./VoiceInputButton";
import { fontFamily } from "../theme/typography";

type Props = {
  destination: TripDestination;
  onChange: (destination: TripDestination) => void;
  onPickMap: () => void;
  onSearch: (query: string) => void;
  searching: boolean;
  searchError: string | null;
};

const manualDraft = (): Extract<TripDestination, { mode: "manual" }> => ({
  mode: "manual",
  text: "",
  lat: null,
  lng: null,
  source: "map_pin",
});

const DestinationPicker: React.FC<Props> = ({ destination, onChange, onPickMap, onSearch, searching, searchError }) => {
  const chooseDestinationless = () => {
    Alert.alert(
      "Record without destination?",
      "GPS recording and upload will continue, but route, ETA, arrival SOC, and destination-aware charging guidance will be limited.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Record trip",
          onPress: () => onChange({
            mode: "destinationless",
            source: "destinationless",
            warningAcknowledged: true,
          }),
        },
      ]
    );
  };

  return (
    <View testID="animated-destination-picker" style={styles.container}>
      <Text style={styles.label}>Destination</Text>
      {destination.mode === "planned" ? (
        <View style={styles.plannedCard}>
          <Text style={styles.provenance}>PLANNED STOP</Text>
          <Text style={styles.destination}>{destination.text}</Text>
          <Text style={styles.coordinates}>{destination.lat.toFixed(5)}, {destination.lng.toFixed(5)}</Text>
          <TouchableOpacity style={styles.secondaryButton} onPress={() => onChange(manualDraft())}>
            <Text style={styles.secondaryText}>Use a different destination</Text>
          </TouchableOpacity>
        </View>
      ) : destination.mode === "manual" ? (
        <View style={styles.manualCard}>
          <TextInput
            testID="trip-destination-text"
            accessibilityLabel="Destination label"
            style={styles.input}
            value={destination.text}
            onChangeText={text => onChange(manualDestinationTextChanged(destination, text))}
            placeholder="Destination name or address"
            placeholderTextColor={Colors.secondaryText}
            returnKeyType="search"
            onSubmitEditing={() => destination.text.trim().length >= 3 && onSearch(destination.text)}
          />
          <VoiceInputButton
            value={destination.text}
            onChangeText={text => onChange(manualDestinationTextChanged(destination, text))}
            onFinalText={onSearch}
            label="Speak destination"
          />
          <TouchableOpacity
            testID="trip-destination-search"
            accessibilityRole="button"
            accessibilityState={{ disabled: searching || destination.text.trim().length < 3 }}
            disabled={searching || destination.text.trim().length < 3}
            style={[styles.searchButton, (searching || destination.text.trim().length < 3) && styles.disabledButton]}
            onPress={() => onSearch(destination.text)}
          >
            {searching ? <ActivityIndicator color={Colors.darkText} /> : <Text style={styles.searchButtonText}>Find on map</Text>}
          </TouchableOpacity>
          {searchError ? <Text accessibilityLiveRegion="assertive" style={styles.error}>{searchError}</Text> : null}
          <TouchableOpacity testID="trip-destination-map" style={styles.mapButton} onPress={onPickMap}>
            <Text style={styles.mapButtonText}>
              {destination.lat == null ? "Choose a point manually" : "Review or move pin"}
            </Text>
          </TouchableOpacity>
          {destination.lat != null && destination.lng != null ? (
            <Text style={styles.coordinates}>{destination.source === "search_result" ? "SEARCH PIN" : "MAP PIN"} · {destination.lat.toFixed(5)}, {destination.lng.toFixed(5)}</Text>
          ) : (
            <Text style={styles.warning}>Find the address or choose a point before starting.</Text>
          )}
        </View>
      ) : (
        <View style={styles.destinationlessCard}>
          <Text style={styles.provenance}>DESTINATIONLESS RECORDING</Text>
          <Text style={styles.warning}>Route and charging predictions are limited. GPS recording remains active.</Text>
          <TouchableOpacity style={styles.secondaryButton} onPress={() => onChange(manualDraft())}>
            <Text style={styles.secondaryText}>Add a destination</Text>
          </TouchableOpacity>
        </View>
      )}
      {destination.mode !== "destinationless" ? (
        <TouchableOpacity style={styles.textButton} onPress={chooseDestinationless}>
          <Text style={styles.textButtonLabel}>Record without destination</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { gap: 10 },
  label: { color: Colors.primaryText, fontFamily: fontFamily.heading, fontSize: 15 },
  plannedCard: { padding: 14, borderRadius: 14, borderWidth: 1, borderColor: Colors.greenAccent, backgroundColor: "rgba(51,204,128,0.08)", gap: 6 },
  manualCard: { padding: 14, borderRadius: 14, borderWidth: 1, borderColor: Colors.premiumCardBorder, backgroundColor: Colors.premiumCardBg, gap: 10 },
  destinationlessCard: { padding: 14, borderRadius: 14, borderWidth: 1, borderColor: Colors.trickeeYellow, backgroundColor: Colors.estimatedBadgeBg, gap: 8 },
  provenance: { color: Colors.greenAccent, fontSize: 10, fontFamily: fontFamily.technical, letterSpacing: 1 },
  destination: { color: Colors.white, fontSize: 18, fontFamily: fontFamily.headingBold },
  coordinates: { color: Colors.secondaryText, fontSize: 12, fontFamily: fontFamily.body },
  input: { minHeight: 50, borderRadius: 12, borderWidth: 1, borderColor: Colors.liquidGlassBorder, color: Colors.white, paddingHorizontal: 13, backgroundColor: Colors.motionInk, fontFamily: fontFamily.bodyMedium },
  searchButton: { minHeight: 48, borderRadius: 12, backgroundColor: Colors.trickeeYellow, alignItems: "center", justifyContent: "center" },
  searchButtonText: { color: Colors.darkText, fontFamily: fontFamily.bodyHeavy },
  disabledButton: { opacity: 0.45 },
  mapButton: { minHeight: 48, borderRadius: 12, borderWidth: 1, borderColor: Colors.motionCyan, alignItems: "center", justifyContent: "center" },
  mapButtonText: { color: Colors.motionCyan, fontFamily: fontFamily.bodyHeavy },
  warning: { color: Colors.trickeeYellow, lineHeight: 18, fontSize: 12 },
  error: { color: Colors.redSoft, lineHeight: 18, fontSize: 12 },
  secondaryButton: { minHeight: 42, borderRadius: 10, borderWidth: 1, borderColor: Colors.borderLight, alignItems: "center", justifyContent: "center", marginTop: 4 },
  secondaryText: { color: Colors.primaryText, fontFamily: fontFamily.bodyBold },
  textButton: { minHeight: 44, alignItems: "center", justifyContent: "center" },
  textButtonLabel: { color: Colors.secondaryText, textDecorationLine: "underline", fontFamily: fontFamily.bodyBold },
});

export default DestinationPicker;
