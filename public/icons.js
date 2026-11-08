const paths = {
  panelLeft: ['M3 4h18v16H3z', 'M9 4v16', 'm15 9-3 3 3 3'],
  chevronRight: ['m9 5 7 7-7 7'],
  flag: ['M5 21V3', 'M5 4h13l-3 4 3 4H5'],
  question: ['M8 8a4 4 0 0 1 8 0c0 3-4 3-4 6', 'M12 18v.1', 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z'],
  activity: ['M6 3.75h12a1.5 1.5 0 0 1 1.5 1.5v15H4.5v-15A1.5 1.5 0 0 1 6 3.75Z', 'M8 3.75v-2h8v2', 'M8 9h8M8 13h8M8 17h5'],
  rules: ['M4 6h16M4 12h16M4 18h16', 'M8 4v4M15 10v4M10 16v4'],
  source: ['M4 3.5h10l5 5v12H4z', 'M14 3.5v5h5', 'M7.5 12h8M7.5 16h8'],
  review: ['m5 12 4.2 4.2L19 6.5'],
  people: ['M9 11a3.25 3.25 0 1 0 0-6.5A3.25 3.25 0 0 0 9 11Z', 'M2.5 20c.5-3.7 2.7-5.6 6.5-5.6s6 1.9 6.5 5.6', 'M16 5a3.25 3.25 0 0 1 0 6.2M17 14.5c2.5.4 3.9 2.1 4.3 5.5'],
  run: ['M8 5.5v13l10-6.5z'],
  results: ['M4 20V11M10 20V5M16 20v-8M22 20H2'],
  complete: ['m5 12 4.2 4.2L19 6.5'],
  current: ['M12 4v8l5 3', 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z'],
  available: ['M8 10V7a4 4 0 0 1 7.5-2', 'M5 10h14v11H5z', 'M12 14v3'],
  locked: ['M7 10V7a5 5 0 0 1 10 0v3', 'M5 10h14v11H5z', 'M12 14v3'],
  eye: ['M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z', 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z'],
  eyeOff: ['m3 3 18 18', 'M10.6 10.6a2 2 0 0 0 2.8 2.8', 'M9.9 5.2A10.8 10.8 0 0 1 12 5c6.5 0 10 7 10 7a16 16 0 0 1-3.1 3.9', 'M6.2 6.2C3.5 8 2 12 2 12s3.5 7 10 7c1 0 1.9-.2 2.8-.5'],
  registered: ['M12 21s-8-4.4-8-11a4.5 4.5 0 0 1 8-2.9A4.5 4.5 0 0 1 20 10c0 6.6-8 11-8 11Z'],
  progress: ['M12 8v4l3 2', 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z'],
  submitted: ['m5 12 4.2 4.2L19 6.5'],
  expired: ['M12 3 22 20H2z', 'M12 9v5M12 17.5v.1']
};

export function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'ui-icon');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  for (const d of paths[name] || []) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}
