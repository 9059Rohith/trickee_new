export type HtmlMapMarker = {
  id: string;
  latitude: number;
  longitude: number;
  title: string;
  color?: string;
  icon?: "car" | "charger" | "user" | "destination";
};

export type HtmlMapPolyline = {
  id: string;
  points: Array<{ latitude: number; longitude: number }>;
  color?: string;
};

const safeJson = (value: unknown) =>
  JSON.stringify(value)
    .replace(/&/g, "\\u0026")
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e");

export function buildOpenStreetMapUpdateScript(options: {
  markers: HtmlMapMarker[];
  polylines?: HtmlMapPolyline[];
  fitBounds?: boolean;
}): string {
  const payload = safeJson({
    markers: options.markers,
    polylines: options.polylines || [],
    fitBounds: options.fitBounds === true,
  });
  return `if(window.__trickeeMapUpdate){window.__trickeeMapUpdate(${payload});}true;`;
}

export function buildOpenStreetMapHtml(options: {
  latitude: number;
  longitude: number;
  zoom: number;
  markers: HtmlMapMarker[];
  polylines?: HtmlMapPolyline[];
  pickerMode?: boolean;
}): string {
  const center = safeJson([options.latitude, options.longitude]);
  const markers = safeJson(options.markers);
  const polylines = safeJson(options.polylines || []);
  const pickerMode = options.pickerMode === true;
  return `<!doctype html>
<html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<link rel="stylesheet" href="leaflet/leaflet.css">
<style>html,body,#map{height:100%;margin:0;background:#081019}.leaflet-container{font-family:system-ui;background:#081019}.leaflet-control-attribution{font-size:9px}.pin{width:18px;height:18px;border-radius:50%;border:3px solid rgba(255,255,255,.9);box-shadow:0 2px 8px #000}</style>
</head><body><div id="map"></div>
<script src="leaflet/leaflet.js"></script>
<script>
const map=L.map('map',{zoomControl:true}).setView(${center},${Math.max(2, Math.min(19, options.zoom))});
const tiles=L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap contributors'}).addTo(map);
let tileFailureReported=false;
tiles.on('tileerror',()=>{if(!tileFailureReported){tileFailureReported=true;window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(JSON.stringify({type:'tile-status',status:'degraded'}));}});
tiles.on('load',()=>{tileFailureReported=false;window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(JSON.stringify({type:'tile-status',status:'online'}));});
const markerLayer=L.layerGroup().addTo(map);
const routeLayer=L.layerGroup().addTo(map);
window.__trickeeMapUpdate=(payload)=>{
  const nextMarkers=Array.isArray(payload.markers)?payload.markers:[];
  const nextPolylines=Array.isArray(payload.polylines)?payload.polylines:[];
  markerLayer.clearLayers();
  routeLayer.clearLayers();
  nextMarkers.forEach(m=>{const icon=L.divIcon({className:'',html:'<div class="pin" style="background:'+String(m.color||'#ffca20').replace(/[^#a-zA-Z0-9(),.% -]/g,'')+'"></div>',iconSize:[24,24],iconAnchor:[12,12]});const pin=L.marker([m.latitude,m.longitude],{icon}).addTo(markerLayer).bindPopup(String(m.title||''));pin.on('click',()=>window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(JSON.stringify({type:'marker',id:m.id})));});
  nextPolylines.forEach(line=>L.polyline(line.points.map(p=>[p.latitude,p.longitude]),{color:String(line.color||'#00e5ff').replace(/[^#a-zA-Z0-9(),.% -]/g,''),weight:5,opacity:.85}).addTo(routeLayer));
  const allPoints=[...nextMarkers.map(m=>[m.latitude,m.longitude]),...nextPolylines.flatMap(line=>line.points.map(p=>[p.latitude,p.longitude]))];
  if(payload.fitBounds&&allPoints.length>1){map.fitBounds(L.latLngBounds(allPoints),{padding:[32,32],maxZoom:15});}
};
window.__trickeeMapUpdate({markers:${markers},polylines:${polylines},fitBounds:true});
${pickerMode ? "map.on('moveend',()=>{const c=map.getCenter();window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(JSON.stringify({type:'map-center',latitude:c.lat,longitude:c.lng}));});" : ""}
</script></body></html>`;
}
