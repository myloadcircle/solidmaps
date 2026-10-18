'use client';

import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Protocol, PMTiles } from 'pmtiles';
import type { GeoJSON } from 'geojson';
import { API_BASE } from '@/lib/api';
import type { ParkingZone, RouteResponse } from '@/shared/types';

const protocol = new Protocol();
maplibregl.addProtocol('pmtiles', protocol.tile);

const PMTILES_URL = process.env.NEXT_PUBLIC_PMTILES_URL || 'https://build.protomaps.com/20260519.pmtiles';
if (PMTILES_URL) {
  protocol.add(new PMTiles(PMTILES_URL));
}

interface SolidMapProps {
  route?: RouteResponse | null;
  parkingZones?: ParkingZone[];
  initialCenter?: [number, number];
  initialZoom?: number;
}

function baseStyle(): maplibregl.StyleSpecification {
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

export const SolidMap: React.FC<SolidMapProps> = ({
  route = null,
  parkingZones = [],
  initialCenter = [-0.1278, 51.5074],
  initialZoom = 11,
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const loadedRef = useRef(false);
  const routeRef = useRef(route);
  const parkingRef = useRef(parkingZones);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [errorState, setErrorState] = useState<string | null>(null);
  routeRef.current = route;
  parkingRef.current = parkingZones;

  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;
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
      });
    } catch (err) {
      setErrorState(err instanceof Error ? err.message : 'Map failed to initialize');
      return;
    }
    map.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'top-right');
    map.on('load', () => {
      loadedRef.current = true;
      setMapLoaded(true);
      map.resize();
      map.addSource('route', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] } as GeoJSON,
      });
      map.addLayer({
        id: 'route-casing',
        type: 'line',
        source: 'route',
        paint: { 'line-color': '#0c4a6e', 'line-width': 9, 'line-opacity': 0.6 },
      });
      map.addLayer({
        id: 'route-line',
        type: 'line',
        source: 'route',
        paint: { 'line-color': '#38bdf8', 'line-width': 5 },
      });
      drawRoute(map, routeRef.current);
      drawParking(map, parkingRef.current, markersRef.current);
    });
    map.on('error', (e) => {
      console.warn('MapLibre error:', e.error ?? e);
      if (!loadedRef.current) {
        setErrorState('Failed to render map tiles. Check network or archive source.');
      }
    });
    mapInstanceRef.current = map;
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
    // initialCenter/initialZoom are initial-only; style depends on build-time env
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (map && map.loaded()) drawRoute(map, route);
  }, [route]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (map && map.loaded()) drawParking(map, parkingZones, markersRef.current);
  }, [parkingZones]);

  return (
    <div className="relative h-full w-full overflow-hidden bg-gray-950">
      <div ref={mapContainerRef} className="absolute inset-0 h-full w-full" aria-label="Map" />

      {!mapLoaded && !errorState && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-gray-900/80 font-mono text-sm text-white backdrop-blur-sm">
          <div className="flex items-center space-x-3">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
            <span>Loading Sovereign Map Engine...</span>
          </div>
        </div>
      )}

      {errorState && (
        <div className="absolute left-4 right-4 top-4 z-20 max-w-md rounded-lg border border-red-500 bg-red-950/90 p-4 font-mono text-xs text-red-200 shadow-xl md:left-auto md:right-4">
          <p className="mb-1 font-bold">Map Rendering Alert</p>
          <p>{errorState}</p>
          <p className="mt-2 text-red-400">WebGL (hardware acceleration) must be enabled in this browser.</p>
        </div>
      )}

      <div className="absolute bottom-4 left-4 z-10 flex items-center space-x-2 rounded-md border border-gray-800 bg-gray-900/90 px-3 py-1.5 font-mono text-xs text-gray-400 shadow-lg">
        <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
        <span>solidmaps.app // edge-native</span>
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
