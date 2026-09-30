import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import DestinationPicker from "../DestinationPicker";
import type { TripDestination } from "../../services/tripStart";

jest.mock("react-native", () => ({
  ActivityIndicator: "ActivityIndicator",
  Alert: { alert: jest.fn() },
  StyleSheet: { create: (styles: unknown) => styles },
  Text: "Text",
  TextInput: "TextInput",
  TouchableOpacity: "TouchableOpacity",
  View: "View",
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("../VoiceInputButton", () => {
  const ReactModule = require("react");
  const { TouchableOpacity } = require("react-native");
  return function MockVoiceInputButton(props: {
    onChangeText: (value: string) => void;
    onFinalText?: (value: string) => void;
  }) {
    return ReactModule.createElement(TouchableOpacity, {
      testID: "trip-destination-voice",
      onPress: () => {
        props.onChangeText("Surat railway station");
        props.onFinalText?.("Surat railway station");
      },
    });
  };
});

const destination: Extract<TripDestination, { mode: "manual" }> = {
  mode: "manual",
  text: "Station Road, Surat",
  lat: 21.2049,
  lng: 72.8406,
  source: "search_result",
};

function renderPicker(overrides: Partial<React.ComponentProps<typeof DestinationPicker>> = {}) {
  const props: React.ComponentProps<typeof DestinationPicker> = {
    destination,
    onChange: jest.fn(),
    onPickMap: jest.fn(),
    onSearch: jest.fn(),
    searching: false,
    searchError: null,
    ...overrides,
  };
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(<DestinationPicker {...props} />);
  });
  return { renderer, props };
}

describe("trip destination picker", () => {
  let consoleError: jest.SpyInstance;

  beforeAll(() => {
    const original = console.error;
    consoleError = jest.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      if (String(args[0]).includes("react-test-renderer is deprecated")) return;
      original(...args);
    });
  });

  afterAll(() => consoleError.mockRestore());

  it("clears stale coordinates when the driver edits a resolved address", () => {
    const { renderer, props } = renderPicker();

    act(() => {
      renderer.root.findByProps({ testID: "trip-destination-text" }).props.onChangeText("New depot address");
    });

    expect(props.onChange).toHaveBeenCalledWith({
      mode: "manual",
      text: "New depot address",
      lat: null,
      lng: null,
      source: "search_result",
    });
  });

  it("searches the entered address when Find on map is pressed", () => {
    const { renderer, props } = renderPicker();

    act(() => {
      renderer.root.findByProps({ testID: "trip-destination-search" }).props.onPress();
    });

    expect(props.onSearch).toHaveBeenCalledWith("Station Road, Surat");
  });

  it("uses a completed voice transcript for the same destination search", () => {
    const { renderer, props } = renderPicker({
      destination: { mode: "manual", text: "", lat: null, lng: null, source: "search_result" },
    });

    act(() => {
      renderer.root.findByProps({ testID: "trip-destination-voice" }).props.onPress();
    });

    expect(props.onSearch).toHaveBeenCalledWith("Surat railway station");
  });
});
