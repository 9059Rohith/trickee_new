import { buildOpenStreetMapHtml } from "../openStreetMapHtml";

describe("real OpenStreetMap renderer", () => {
  it("renders OSM tiles and markers at their real coordinates", () => {
    const html = buildOpenStreetMapHtml({
      latitude: 21.17,
      longitude: 72.83,
      zoom: 14,
      markers: [
        {
          id: "vehicle-1",
          latitude: 21.171,
          longitude: 72.831,
          title: "OLA-S1",
          color: "#ffca20",
          icon: "car",
        },
      ],
    });

    expect(html).toContain("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png");
    expect(html).toContain('"latitude":21.171');
    expect(html).toContain("L.marker([m.latitude,m.longitude]");
    expect(html).toContain("© OpenStreetMap contributors");
    expect(html).not.toContain("roadHorizontal");
  });

  it("renders recorded polylines and emits the settled picker center", () => {
    const html = buildOpenStreetMapHtml({
      latitude: 21.17,
      longitude: 72.83,
      zoom: 14,
      markers: [],
      pickerMode: true,
      polylines: [{
        id: "trip-1",
        color: "#00e5ff",
        points: [
          { latitude: 21.17, longitude: 72.83 },
          { latitude: 21.18, longitude: 72.84 },
        ],
      }],
    });

    expect(html).toContain('"id":"trip-1"');
    expect(html).toContain("L.polyline(line.points.map");
    expect(html).toContain("map.on('moveend'");
    expect(html).toContain("type:'map-center'");
    expect(html).toContain("21.18");
  });
});
