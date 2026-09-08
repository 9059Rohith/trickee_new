export type HtmlMapMarker = {
  id: string;
  latitude: number;
  longitude: number;
  title: string;
  color?: string;
  icon?: "car" | "charger" | "user" | "destination";
};

const safeJson = (value: unknown) =>
  JSON.stringify(value)
    .replace(/&/g, "\\u0026")
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e");

export function buildOpenStreetMapHtml(options: {
  latitude: number;
  longitude: number;
  zoom: number;
  markers: HtmlMapMarker[];
}): string {
  const center = safeJson([options.latitude, options.longitude]);
  const markers = safeJson(options.markers);
  return `<!doctype html>
<html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" crossorigin="">
<style>html,body,#map{height:100%;margin:0;background:#081019}.leaflet-container{font-family:system-ui;background:#081019}.leaflet-control-attribution{font-size:9px}.pin{width:18px;height:18px;border-radius:50%;border:3px solid rgba(255,255,255,.9);box-shadow:0 2px 8px #000}</style>
</head><body><div id="map"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" crossorigin=""></script>
<script>
const map=L.map('map',{zoomControl:true}).setView(${center},${Math.max(2, Math.min(19, options.zoom))});
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap contributors'}).addTo(map);
const markers=${markers};
markers.forEach(m=>{const icon=L.divIcon({className:'',html:'<div class="pin" style="background:'+String(m.color||'#ffca20').replace(/[^#a-zA-Z0-9(),.% -]/g,'')+'"></div>',iconSize:[24,24],iconAnchor:[12,12]});const pin=L.marker([m.latitude,m.longitude],{icon}).addTo(map).bindPopup(String(m.title||''));pin.on('click',()=>window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(JSON.stringify({type:'marker',id:m.id})));});
if(markers.length>1){map.fitBounds(L.latLngBounds(markers.map(m=>[m.latitude,m.longitude])),{padding:[32,32],maxZoom:15});}
</script></body></html>`;
}
