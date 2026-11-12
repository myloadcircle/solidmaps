'use client';

import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Protocol, PMTiles } from 'pmtiles';
import type { GeoJSON } from 'geojson';
import { API_BASE } from '@/lib/api';
import type { ParkingZone, RouteResponse } from '@/shared/types';

const protocol = new Protocol();
maplibregl.addProtocol('pmtiles', protocol.tile);

// MapLibre 6 derives its worker URL from `import.meta.url`, which the bundler bakes to a
// build-machine file path. The shipped bundle then asks for a worker at "" and reports "Worker
// failed to load", so the vector style never renders and every user silently drops to raster.
// Point it at the copy we ship in /public (see scripts/sync-maplibre-worker.mjs).
maplibregl.setWorkerUrl('/maplibre-gl-worker.js');

const PMTILES_URL = process.env.NEXT_PUBLIC_PMTILES_URL || '';
const MAP_STYLE = process.env.NEXT_PUBLIC_MAP_STYLE || '';
const DEFAULT_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';

if (PMTILES_URL) {
  protocol.add(new PMTiles(PMTILES_URL));
}

/**
 * The slice of a map engine the app actually drives. MapLibre's Map satisfies this as-is;
 * the WebGL-free Leaflet tier implements it, so ActiveNavigation can follow the vehicle
 * on either engine.
 */
export interface MapView {
  easeTo(options: {
    center: [number, number];
    zoom: number;
    bearing?: number;
    pitch?: number;
    duration?: number;
  }): void;
  getBearing(): number;
}

interface SolidMapProps {
  route?: RouteResponse | null;
  parkingZones?: ParkingZone[];
  initialCenter?: [number, number];
  initialZoom?: number;
  onMapReady?: (map: MapView) => void;
}

function baseStyle(): string | maplibregl.StyleSpecification {
  if (MAP_STYLE) return MAP_STYLE;
  if (PMTILES_URL) {
    return {
      version: 8,
      sources: {
        'solidmaps-vector': {
          type: 'vector',
          url: `pmtiles://${PMTILES_URL}`,
          attribution: '© solidmaps.app & OpenStreetMap contributors',
        },
      },
      layers: [
        { id: 'background', type: 'background', paint: { 'background-color': '#111827' } },
        {
          id: 'water',
          type: 'fill',
          source: 'solidmaps-vector',
          'source-layer': 'water',
          paint: { 'fill-color': '#1f2937' },
        },
        {
          id: 'roads',
          type: 'line',
          source: 'solidmaps-vector',
          'source-layer': 'transportation',
          paint: { 'line-color': '#3b82f6', 'line-width': 1.5 },
        },
        {
          id: 'buildings',
          type: 'fill-extrusion',
          source: 'solidmaps-vector',
          'source-layer': 'buildings',
          paint: {
            'fill-extrusion-color': '#4b5563',
            'fill-extrusion-height': ['get', 'height'],
            'fill-extrusion-base': 0,
            'fill-extrusion-opacity': 0.9,
          },
        },
      ],
    } as maplibregl.StyleSpecification;
  }
  return DEFAULT_STYLE_URL;
}

function rasterStyle(): maplibregl.StyleSpecification {
  return {
    version: 8,
    sources: {
      osm: {
        type: 'raster',
        tiles: [`${API_BASE}/tiles/{z}/{x}/{y}`],
        tileSize: 256,
        attribution: '© OpenStreetMap contributors',
      },
    },
    layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
  };
}

function webgl2Supported(): boolean {
  try {
    return !!document.createElement('canvas').getContext('webgl2');
  } catch {
    return false;
  }
}

function setupRouteLayers(map: maplibregl.Map): void {
  if (map.getSource('route')) return;
  map.addSource('route', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] } as GeoJSON,
  });
  map.addLayer({
    id: 'route-casing',
    type: 'line',
    source: 'route',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#0c4a6e', 'line-width': 9, 'line-opacity': 0.6 },
  });
  map.addLayer({
    id: 'route-line',
    type: 'line',
    source: 'route',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#38bdf8', 'line-width': 5 },
  });
}
function add3DBuildings(map: maplibregl.Map): void {
  const style = map.getStyle();
  const layers = (style.layers ?? []) as maplibregl.LayerSpecification[];
  if (layers.length === 0 || layers.some((l) => l.id === 'buildings-3d')) return;
  const sources = style.sources as Record<string, maplibregl.SourceSpecification> | undefined;
  const vectorEntry = Object.entries(sources ?? {}).find(([, s]) => s?.type === 'vector');
  if (!vectorEntry) return;
  const [sourceId] = vectorEntry;
  const firstSymbol = layers.find((l) => l.type === 'symbol')?.id;
  const layer: maplibregl.LayerSpecification = {
    id: 'buildings-3d',
    type: 'fill-extrusion',
    source: sourceId,
    'source-layer': 'building',
    minzoom: 14,
    paint: {
      'fill-extrusion-color': '#9ca3af',
      'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 8],
      'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
      'fill-extrusion-opacity': 0.85,
    },
  };
  try {
    map.addLayer(layer, firstSymbol);
  } catch {
    // Style has no OpenMapTiles building layer — skip 3D extrusion.
  }
}

export const SolidMap: React.FC<SolidMapProps> = ({
  route = null,
  parkingZones = [],
  initialCenter = [-0.1278, 51.5074],
  initialZoom = 11,
  onMapReady,
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  // WebGL-free tier. Only one engine is ever live at a time — which one is decided once, on mount.
  const leafletMapRef = useRef<L.Map | null>(null);
  const leafletMarkersRef = useRef<L.Marker[]>([]);
  const loadedRef = useRef(false);
  const fallbackTriedRef = useRef(false);
  const routeRef = useRef(route);
  const parkingRef = useRef(parkingZones);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [errorState, setErrorState] = useState<string | null>(null);
  // Set when the browser has no WebGL2: we drop to the Leaflet raster tier rather than show no map.
  const [webglFree, setWebglFree] = useState(false);
  const [errorDismissed, setErrorDismissed] = useState(false);
  const [mapKey, setMapKey] = useState(0);
  routeRef.current = route;
  parkingRef.current = parkingZones;

  const retry = () => {
    fallbackTriedRef.current = false;
    setErrorState(null);
    setErrorDismissed(false);
    setMapLoaded(false);
    setMapKey((k) => k + 1);
  };

  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current || leafletMapRef.current) return;
    if (!webgl2Supported()) {
      // MapLibre cannot start without WebGL2, so render raster tiles with Leaflet, which
      // needs no GPU. Route, parking and turn-by-turn all keep working.
      const container = mapContainerRef.current;
      container.innerHTML = '';
      const leafletMap = new L.Map(container, {
        center: [initialCenter[1], initialCenter[0]],
        zoom: initialZoom,
        zoomControl: true,
      });
      // Match the MapLibre tier: no engine name in the chrome, just the data attribution.
      leafletMap.attributionControl.setPrefix(false);
      L.tileLayer(`${API_BASE}/tiles/{z}/{x}/{y}`, {
        tileSize: 256,
        maxZoom: 19,
        attribution: '© OpenStreetMap contributors',
      }).addTo(leafletMap);
      leafletMapRef.current = leafletMap;
      loadedRef.current = true;
      setWebglFree(true);
      setMapLoaded(true);
      setErrorState(
        'Showing the lightweight map: this browser has no WebGL2, so the vector map is off. Routing, parking and turn-by-turn still work.',
      );
      drawRouteLeaflet(leafletMap, routeRef.current);
      drawParkingLeaflet(leafletMap, parkingRef.current, leafletMarkersRef.current);
      onMapReady?.(leafletView(leafletMap));
      return () => {
        leafletMarkersRef.current.forEach((m) => m.remove());
        leafletMarkersRef.current = [];
        leafletMap.remove();
        leafletMapRef.current = null;
        loadedRef.current = false;
      };
    }
    mapContainerRef.current.innerHTML = '';
    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container: mapContainerRef.current,
        style: baseStyle(),
        center: initialCenter,
        zoom: initialZoom,
        pitch: 45,
        bearing: 0,
        attributionControl: { compact: true },
      });
    } catch (err) {
      setErrorState(
        `Map failed to initialize: ${err instanceof Error ? err.message : 'unknown error'}. Route planning still works below.`,
      );
      return;
    }
    map.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'top-right');
    map.addControl(
      new maplibregl.GeolocateControl({
        positionOptions: { enableHighAccuracy: true, maximumAge: 2000 },
        trackUserLocation: true,
      }),
      'top-right',
    );
    map.on('style.load', () => {
      try {
        map.setProjection({ type: 'globe' });
      } catch {
        // Projection control unavailable in this engine build — stay on mercator.
      }
      add3DBuildings(map);
      setupRouteLayers(map);
      drawRoute(map, routeRef.current);
      drawParking(map, parkingRef.current, markersRef.current);
    });
    map.on('load', () => {
      loadedRef.current = true;
      setMapLoaded(true);
      setErrorState(null);
      map.resize();
      setupRouteLayers(map);
      drawRoute(map, routeRef.current);
      drawParking(map, parkingRef.current, markersRef.current);
    });
    map.on('error', (e) => {
      const detail = e.error instanceof Error ? e.error.message : String(e.error ?? e);
      console.warn('MapLibre error:', detail);
      if (loadedRef.current) return;
      if (!fallbackTriedRef.current) {
        // Vector tiles unreachable — retry once on the raster fallback before giving up.
        fallbackTriedRef.current = true;
        setErrorState('Map tiles are slow or blocked — switching to the fallback map…');
        try {
          map.setStyle(rasterStyle());
          map.once('idle', () => {
            if (!mapInstanceRef.current) return;
            loadedRef.current = true;
            setMapLoaded(true);
            setErrorState(null);
          });
          // Safety net: if tiles genuinely never arrive, say so honestly.
          // Check the engine, not a flag — tiles can render while 'load'/'idle'
          // events race us (a rendered map must never be called unreachable).
          window.setTimeout(() => {
            const m = mapInstanceRef.current;
            if (!m || loadedRef.current) return;
            let tilesReady = false;
            try {
              tilesReady = m.areTilesLoaded();
            } catch {
              tilesReady = false;
            }
            if (tilesReady) {
              loadedRef.current = true;
              setMapLoaded(true);
              setErrorState(null);
              return;
            }
            setErrorState('Maps are unreachable right now (offline or blocked network). Route planning and directions still work — tap Retry when you are back online.');
          }, 8000);
        } catch {
          setErrorState(`Map failed to render: ${detail}`);
        }
        return;
      }
      setErrorState(`Map failed to render: ${detail}. Tap Retry — routing still works below.`);
    });
    mapInstanceRef.current = map;
    onMapReady?.(map);
    if (process.env.NODE_ENV !== 'production') {
      (window as unknown as { __solidmapsMap?: maplibregl.Map }).__solidmapsMap = map;
    }
    return () => {
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      map.remove();
      mapInstanceRef.current = null;
      loadedRef.current = false;
    };
    // Retry remounts via mapKey; center/zoom are initial-only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapKey]);

  useEffect(() => {
    const leafletMap = leafletMapRef.current;
    if (leafletMap) {
      drawRouteLeaflet(leafletMap, route);
      return;
    }
    const map = mapInstanceRef.current;
    if (map && map.loaded()) drawRoute(map, route);
  }, [route]);

  useEffect(() => {
    const leafletMap = leafletMapRef.current;
    if (leafletMap) {
      drawParkingLeaflet(leafletMap, parkingZones, leafletMarkersRef.current);
      return;
    }
    const map = mapInstanceRef.current;
    if (map && map.loaded()) drawParking(map, parkingZones, markersRef.current);
  }, [parkingZones]);

  return (
    <div className="relative h-full w-full overflow-hidden bg-gray-950">
      {/* One container for both tiers: MapLibre when WebGL2 is present, Leaflet when it is not. */}
      <div ref={mapContainerRef} className="absolute inset-0 h-full w-full" aria-label="Map" />

      {!mapLoaded && !errorState && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-gray-900/80 font-mono text-sm text-white backdrop-blur-sm">
          <div className="flex items-center space-x-3">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
            <span>Loading map…</span>
          </div>
        </div>
      )}

      {errorState && !errorDismissed && (
        <div
          role="alert"
          className="absolute left-1/2 top-16 z-40 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 rounded-xl border border-amber-500/50 bg-slate-900/95 p-3.5 text-xs text-amber-200 shadow-xl backdrop-blur"
        >
          <div className="flex items-start gap-2">
            <span aria-hidden="true" className="mt-0.5 text-base leading-none">⚠️</span>
            <div className="flex-1">
              <p className="font-semibold text-amber-100">
                {webglFree ? 'Lightweight map mode' : 'Map issue'}
              </p>
              <p className="mt-1 leading-relaxed text-amber-200/90">{errorState}</p>
              <div className="mt-2.5 flex gap-2">
                {!webglFree && (
                  <button
                    onClick={retry}
                    className="rounded-lg bg-amber-500/20 px-3 py-1.5 font-semibold text-amber-100 hover:bg-amber-500/30"
                  >
                    Retry
                  </button>
                )}
                <button
                  onClick={() => setErrorDismissed(true)}
                  className="rounded-lg px-3 py-1.5 text-amber-200/70 hover:bg-amber-500/10"
                >
                  Dismiss
                </button>
              </div>
            </div>
            <button
              onClick={() => setErrorDismissed(true)}
              aria-label="Close"
              className="rounded p-1 text-amber-200/50 hover:text-amber-100"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      <div className="absolute bottom-4 left-4 z-10 hidden items-center space-x-2 rounded-md border border-gray-800 bg-gray-900/90 px-3 py-1.5 font-mono text-xs text-gray-400 shadow-lg md:flex">
        <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
        <span>solidmap.app // edge-native</span>
      </div>
    </div>
  );
};

function drawRoute(map: maplibregl.Map, route: RouteResponse | null): void {
  const source = map.getSource('route') as maplibregl.GeoJSONSource | undefined;
  if (!source) return;
  const features: GeoJSON.Feature[] = [];
  const coordinates = route?.geometry?.coordinates ?? [];
  if (coordinates.length > 0) {
    features.push({
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates },
    });
    const lons = coordinates.map((c) => c[0]);
    const lats = coordinates.map((c) => c[1]);
    map.fitBounds(
      [
        [Math.min(...lons), Math.min(...lats)],
        [Math.max(...lons), Math.max(...lats)],
      ],
      { padding: 80, maxZoom: 15 },
    );
  }
  source.setData({ type: 'FeatureCollection', features } as GeoJSON);
}

function drawParking(map: maplibregl.Map, zones: ParkingZone[], markers: maplibregl.Marker[]): void {
  markers.forEach((m) => m.remove());
  markers.length = 0;
  for (const z of zones) {
    const el = document.createElement('div');
    el.className = 'rounded border border-white bg-blue-600 px-1.5 py-0.5 text-xs font-bold text-white shadow';
    el.textContent = 'P';
    markers.push(
      new maplibregl.Marker(el)
        .setLngLat([z.lon, z.lat])
        .setPopup(new maplibregl.Popup({ offset: 24 }).setText(z.name))
        .addTo(map),
    );
  }
}

/** Adapts Leaflet's camera to the MapView contract ActiveNavigation drives. Leaflet has no
 *  bearing or pitch, so those are accepted and ignored rather than throwing mid-navigation. */
function leafletView(map: L.Map): MapView {
  return {
    easeTo: ({ center, zoom, duration }) => {
      map.flyTo([center[1], center[0]], zoom, { duration: (duration ?? 800) / 1000 });
    },
    getBearing: () => 0,
  };
}

const leafletRouteLayers = new WeakMap<L.Map, L.LayerGroup>();

function drawRouteLeaflet(map: L.Map, route: RouteResponse | null): void {
  leafletRouteLayers.get(map)?.remove();
  leafletRouteLayers.delete(map);
  const coordinates = route?.geometry?.coordinates ?? [];
  if (coordinates.length === 0) return;
  // GeoJSON is [lon, lat]; Leaflet wants [lat, lng].
  const latlngs = coordinates.map((c) => [c[1], c[0]] as [number, number]);
  const group = L.layerGroup([
    L.polyline(latlngs, { color: '#0c4a6e', weight: 9, opacity: 0.6, lineJoin: 'round', lineCap: 'round' }),
    L.polyline(latlngs, { color: '#38bdf8', weight: 5, lineJoin: 'round', lineCap: 'round' }),
  ]).addTo(map);
  leafletRouteLayers.set(map, group);
  map.fitBounds(L.latLngBounds(latlngs), { padding: [80, 80], maxZoom: 15 });
}

function drawParkingLeaflet(map: L.Map, zones: ParkingZone[], markers: L.Marker[]): void {
  markers.forEach((m) => m.remove());
  markers.length = 0;
  for (const z of zones) {
    const el = document.createElement('div');
    el.className = 'rounded border border-white bg-blue-600 px-1.5 py-0.5 text-xs font-bold text-white shadow';
    el.textContent = 'P';
    markers.push(
      L.marker([z.lat, z.lon], { icon: L.divIcon({ html: el, className: '', iconSize: [22, 18] }) })
        .bindPopup(z.name)
        .addTo(map),
    );
  }
}
