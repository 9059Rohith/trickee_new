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
});
