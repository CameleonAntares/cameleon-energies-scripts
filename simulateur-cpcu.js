const state = {
    address: '', lat: null, lon: null, inParis: null,
    buildingType: 'tertiaire', collectif: 'oui',
    surface: null, puissance: null, conso: null, lots: null,
    energy: 'gaz', context: 'remplacement',
    proximity: null, // { inZDP, nearNetwork, distanceM, source } | null
  };

  const POWER_COEFF = { tertiaire: 0.060, residentiel: 0.050, hotel: 0.070, sante: 0.080 };
  const EQUIV_HOURS = 1600;
  const CPCU_R1 = 70;
  const CPCU_R2 = 33;
  const CPCU_CO2 = 183;
  const ENERGY_PRICE = { gaz: 105, fioul: 125, electricite: 175, autre: 110 };
  const ENERGY_CO2 = { gaz: 234, fioul: 300, electricite: 180, autre: 260 };
  const ENERGY_LABEL = { gaz: 'Gaz naturel', fioul: 'Fioul', electricite: 'Électricité', autre: 'Autre/Mixte' };
  const CEE_PRICE_KWH = 0.0065; // €/kWh cumac (estimation conservatrice, varie selon signataire)

  // === CEE Coup de pouce ===
  // Applicable si remplacement gaz ou fioul
  // Résidentiel collectif : forfait ≤125 lots = 12 000 MWh cumac ; >125 lots = 54 000×N + 5 200 000 kWh cumac
  // Tertiaire / autres : estimation ~15 €/MWh consommé (simplifié)
  function calcCEE(buildingType, energy, C, lots) {
    const eligible = (energy === 'gaz' || energy === 'fioul');
    if (!eligible) return { amount: 0, detail: 'Non éligible (énergie actuelle non gaz/fioul)', forfait: false };

    if (buildingType === 'residentiel') {
      if (lots === null) {
        // nombre de lots non renseigné → applique forfait ≤125 par défaut
        const vol = 12000000;
        return {
          amount: Math.round(vol * CEE_PRICE_KWH),
          detail: 'Forfait ≤125 lots appliqué par défaut (nombre de lots non renseigné)',
          volume_kwh: vol,
          forfait: true,
          seuil: 'unknown'
        };
      } else if (lots <= 125) {
        const vol = 12000000; // kWh cumac — forfait fixe
        return {
          amount: Math.round(vol * CEE_PRICE_KWH),
          detail: `${lots} lots — Forfait ≤125 lots`,
          volume_kwh: vol,
          forfait: true,
          seuil: 'sous125'
        };
      } else {
        const vol = 54000 * lots + 5200000; // kWh cumac
        return {
          amount: Math.round(vol * CEE_PRICE_KWH),
          detail: `${lots} lots — Formule progressive`,
          volume_kwh: vol,
          forfait: false,
          seuil: 'sur125'
        };
      }
    } else {
      // Tertiaire, hôtel, santé → estimation simplifiée
      const amount = Math.round(C * 15);
      return {
        amount,
        detail: 'Estimation bâtiment non résidentiel (~15 €/MWh)',
        volume_kwh: null,
        forfait: false,
        seuil: null
      };
    }
  }

  function compute() {
    state.surface = parseFloat(document.getElementById('surface').value) || null;
    state.puissance = parseFloat(document.getElementById('puissance').value) || null;
    state.conso = parseFloat(document.getElementById('conso').value) || null;
    state.lots = parseFloat(document.getElementById('lots').value) || null;

    const coeff = POWER_COEFF[state.buildingType] || 0.060;
    let P = state.puissance || (state.surface ? state.surface * coeff : 200);
    let C = state.conso || (state.surface ? (state.surface * coeff * EQUIV_HOURS) / 1000 : (P * EQUIV_HOURS) / 1000);
    P = Math.round(P);
    C = Math.round(C);

    const inParis = state.inParis !== false;
    const hasCollectif = state.collectif === 'oui';
    const puissanceSuffisante = P >= 100;
    const px = state.proximity; // proximity check result
    // Use dynamic proximity data if available; otherwise fall back to Paris location
    const confirmedInZDP = px && px.inZDP;
    const confirmedNearNetwork = px && px.nearNetwork;
    const confirmedOutsideZone = px !== null && !px.nearNetwork;
    const inCPCUZone = confirmedOutsideZone ? false : inParis; // downgrade eligibility if API says no network
    const obligation = puissanceSuffisante && inCPCUZone && confirmedInZDP && (state.context === 'remplacement' || state.context === 'neuf');

    let eligStatus, eligClass;
    if (confirmedOutsideZone) { eligStatus = 'hors_zone'; eligClass = 'red'; }
    else if (inCPCUZone && hasCollectif && puissanceSuffisante) { eligStatus = 'eligible'; eligClass = 'green'; }
    else if (inCPCUZone && puissanceSuffisante && !hasCollectif) { eligStatus = 'convertible'; eligClass = 'orange'; }
    else if (!puissanceSuffisante && inCPCUZone) { eligStatus = 'faible_puissance'; eligClass = 'orange'; }
    else { eligStatus = 'hors_zone'; eligClass = 'red'; }

    const branchement = P * 10;
    const sousStation = 25000 + P * 80;
    const totalRaccordement = branchement + sousStation;

    const ceeData = calcCEE(state.buildingType, state.energy, C, state.lots);
    const netRaccordement = Math.max(totalRaccordement - ceeData.amount, 0);

    const annualCPCU = Math.round(C * CPCU_R1 + P * CPCU_R2);
    const annualActuel = Math.round(C * ENERGY_PRICE[state.energy]);
    const economies = annualActuel - annualCPCU;

    const co2Actuel = Math.round(C * ENERGY_CO2[state.energy] / 1000);
    const co2CPCU = Math.round(C * CPCU_CO2 / 1000);
    const co2Saved = co2Actuel - co2CPCU;
    const co2PctSaved = co2Actuel > 0 ? Math.round((co2Saved / co2Actuel) * 100) : 0;

    const payback = economies > 0 ? (netRaccordement / economies).toFixed(1) : '—';

    return { P, C, eligStatus, eligClass, obligation, branchement, sousStation, totalRaccordement,
      ceeData, netRaccordement, annualCPCU, annualActuel, economies, co2Actuel, co2CPCU,
      co2Saved, co2PctSaved, payback, inParis, hasCollectif, puissanceSuffisante,
      confirmedInZDP, confirmedNearNetwork, confirmedOutsideZone };
  }

  function computeAndShow() {
    const r = compute();
    goToStep(4);

    const maxVal = r.annualActuel;
    const cpcu_pct = Math.round((r.annualCPCU / maxVal) * 100);

    const eligMessages = {
      eligible: {
        title: '✅ Votre bâtiment est potentiellement éligible au raccordement CPCU',
        desc: `${r.obligation ? '⚡ Raccordement <strong>obligatoire</strong> dans la Zone de Développement Prioritaire lors du renouvellement de l\'installation. ' : ''}Chauffage collectif ✓ &nbsp;|&nbsp; Puissance ${r.P} kW ≥ 100 kW ✓ &nbsp;|&nbsp; Paris ✓`
      },
      convertible: {
        title: '🔶 Éligible sous conditions — adaptation requise',
        desc: `Votre installation n'est pas collective. Une conversion interne est nécessaire en amont du raccordement. Une étude de faisabilité CPCU est recommandée.`
      },
      faible_puissance: {
        title: '⚠️ Puissance estimée inférieure au seuil d\'obligation (100 kW)',
        desc: `Puissance estimée : ${r.P} kW. Le raccordement reste possible à titre volontaire. Contactez la CPCU pour une faisabilité.`
      },
      hors_zone: {
        title: '🔴 Adresse potentiellement hors zone de desserte CPCU',
        desc: `Le réseau CPCU couvre principalement Paris intra-muros. Consultez <a href="https://france-chaleur-urbaine.beta.gouv.fr" target="_blank">France Chaleur Urbaine</a> pour votre secteur.`
      }
    };
    const msg = eligMessages[r.eligStatus];

    // CEE bloc HTML
    let ceeHtml = '';
    if (r.ceeData.amount > 0) {
      const isForfait = r.ceeData.seuil === 'sous125' || r.ceeData.seuil === 'unknown';
      const volLabel = r.ceeData.volume_kwh ? `Volume : ${(r.ceeData.volume_kwh / 1000000).toFixed(1)} GWh cumac` : '';
      const forfaitBadge = isForfait ? `<span class="cee-forfait-badge">★ Forfait ≤125 lots</span>` : '';

      ceeHtml = `
      <div class="cee-bloc">
        <h3>💰 Aide CEE « Coup de pouce Chauffage » — Applicable à votre situation</h3>
        <p style="font-size:13px; color:#92400e; margin-bottom:10px;">
          En remplaçant votre ${ENERGY_LABEL[state.energy].toLowerCase()} par le réseau de chaleur (alimenté à >50% en EnR&R), vous êtes éligible au dispositif Coup de pouce. <strong>Engagements travaux avant le 31/12/2025, raccordement avant le 31/12/2026.</strong>
        </p>
        <div class="cee-bloc-grid">
          <div class="cee-item">
            <div class="cee-label">Prime CEE estimée</div>
            ${forfaitBadge}
            <div class="cee-val">${r.ceeData.amount.toLocaleString('fr-FR')} €</div>
            <div class="cee-note">${r.ceeData.detail}</div>
          </div>
          <div class="cee-item">
            <div class="cee-label">Coût raccordement après aide</div>
            <div class="cee-val">${r.netRaccordement.toLocaleString('fr-FR')} €HT</div>
            <div class="cee-note">${volLabel ? volLabel + ' • ' : ''}Le montant réel varie selon le signataire CEE choisi</div>
          </div>
        </div>
        ${(r.ceeData.seuil === 'sous125' || r.ceeData.seuil === 'unknown') ? `
        <div style="margin-top:12px; padding:10px 14px; background:#fef3c7; border-radius:8px; font-size:12px; color:#78350f; line-height:1.6;">
          <strong>📌 Dispositif ≤125 lots :</strong> Pour les bâtiments résidentiels collectifs de 2 à 125 logements, le volume CEE est fixé à un <strong>forfait de 12 000 MWh cumac</strong>, indépendamment de la taille précise du bâtiment — ce qui favorise les petites et moyennes copropriétés. Pour un bâtiment de plus de 125 lots, la formule progressive <code>54 000×N + 5 200 000 kWh cumac</code> s'applique et génère une prime plus élevée. <a href="https://www.ecologie.gouv.fr/politiques-publiques/coup-pouce-chauffage-batiments-residentiels-collectifs-tertiaires" target="_blank" style="color:#b45309; font-weight:600;">Fiche officielle →</a>
        </div>` : `
        <div style="margin-top:12px; padding:10px 14px; background:#fef3c7; border-radius:8px; font-size:12px; color:#78350f; line-height:1.6;">
          <strong>📌 Formule progressive >125 lots :</strong> Avec ${state.lots || '?'} logements, le volume CEE suit la formule <code>54 000 × N + 5 200 000 kWh cumac</code>, générant une prime plus élevée qu'en forfait. <a href="https://www.ecologie.gouv.fr/politiques-publiques/coup-pouce-chauffage-batiments-residentiels-collectifs-tertiaires" target="_blank" style="color:#b45309; font-weight:600;">Fiche officielle →</a>
        </div>`}
      </div>`;
    }

    const html = `
      <div class="eligibility-banner ${r.eligClass}">
        <div class="elig-icon">${r.eligClass === 'green' ? '🟢' : r.eligClass === 'orange' ? '🟡' : '🔴'}</div>
        <div>
          <div class="elig-title">${msg.title}</div>
          <div class="elig-desc">${msg.desc}</div>
        </div>
      </div>

      ${buildProximityResultBlock(r)}

      <div class="results-grid">
        <div class="result-card">
          <div class="rc-label">Puissance estimée</div>
          <div class="rc-value">${r.P.toLocaleString('fr-FR')}<span class="rc-unit"> kW</span></div>
          <div class="rc-note">Consommation : ${r.C.toLocaleString('fr-FR')} MWh/an</div>
        </div>
        <div class="result-card">
          <div class="rc-label">Coût raccordement brut</div>
          <div class="rc-value">${r.totalRaccordement.toLocaleString('fr-FR')}<span class="rc-unit"> €HT</span></div>
          <div class="rc-note">Branchement (barème CPCU) + poste de livraison</div>
        </div>
        <div class="result-card highlight">
          <div class="rc-label">Économies annuelles estimées</div>
          <div class="rc-value">${r.economies > 0 ? '+' : ''}${r.economies.toLocaleString('fr-FR')}<span class="rc-unit"> €/an</span></div>
          <div class="rc-note">vs ${ENERGY_LABEL[state.energy]}</div>
        </div>
        <div class="result-card">
          <div class="rc-label">Retour sur investissement net</div>
          <div class="rc-value">${r.payback}<span class="rc-unit"> ans</span></div>
          <div class="rc-note">Après déduction aide CEE estimée</div>
        </div>
      </div>

      <div class="chart-section">
        <div class="chart-title">📊 Comparaison du coût annuel de chauffage</div>
        <div class="chart-bar-group">
          <div class="chart-bar-label"><span class="name">🌿 CPCU — Réseau de chaleur Paris</span><span class="val">${r.annualCPCU.toLocaleString('fr-FR')} €/an</span></div>
          <div class="chart-bar-track"><div class="chart-bar-fill bar-cpcu" style="width:0%" data-target="${cpcu_pct}%"></div></div>
        </div>
        <div class="chart-bar-group">
          <div class="chart-bar-label"><span class="name">⬜ ${ENERGY_LABEL[state.energy]}</span><span class="val">${r.annualActuel.toLocaleString('fr-FR')} €/an</span></div>
          <div class="chart-bar-track"><div class="chart-bar-fill bar-alt" style="width:0%" data-target="100%"></div></div>
        </div>
        <div class="input-hint" style="margin-top:10px;">Tarif CPCU : terme variable R1 ≈ 70 €/MWh + abonnement R2 ≈ 33 €/kW/an (estimation 2025)</div>
      </div>

      ${ceeHtml}

      <div class="co2-section">
        <h3>🌍 Impact environnemental</h3>
        <div class="co2-stats">
          <div class="co2-stat">
            <div class="val">${r.co2CPCU.toLocaleString('fr-FR')} t</div>
            <div class="lbl">CO₂/an avec CPCU<br>(183 kgCO₂/MWh)</div>
          </div>
          <div class="co2-stat">
            <div class="val">${r.co2Actuel.toLocaleString('fr-FR')} t</div>
            <div class="lbl">CO₂/an actuel<br>(${ENERGY_CO2[state.energy]} kgCO₂/MWh)</div>
          </div>
          <div class="co2-stat saved">
            <div class="val">${r.co2Saved > 0 ? '-' : ''}${Math.abs(r.co2Saved).toLocaleString('fr-FR')} t</div>
            <div class="lbl">CO₂ économisées/an<br>(${r.co2PctSaved}% de réduction)</div>
          </div>
        </div>
        <div style="font-size:12px; opacity:0.7; margin-top:14px;">Le réseau CPCU est alimenté à 50,7 % par des EnR&R (2023) — objectif 75 % en 2030.</div>
      </div>

      <div class="info-note">
        🗺️ Vérifiez si votre adresse est dans la Zone de Développement Prioritaire (60 m du réseau) sur la <a href="https://france-chaleur-urbaine.beta.gouv.fr/carte" target="_blank">carte France Chaleur Urbaine →</a>
      </div>

      <div class="cta-section">
        <h3>Passer à l'étape suivante</h3>
        <p>Ces résultats sont des estimations. La CPCU réalise gratuitement une étude de faisabilité personnalisée.</p>
        <div class="cta-buttons">
          <a href="https://www.cpcu.fr/se-raccorder/" target="_blank" class="btn btn-primary">
            <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg>
            Contacter la CPCU
          </a>
          <a href="https://france-chaleur-urbaine.beta.gouv.fr" target="_blank" class="btn btn-secondary">🗺️ France Chaleur Urbaine</a>
          <a href="https://www.ecologie.gouv.fr/politiques-publiques/coup-pouce-chauffage-batiments-residentiels-collectifs-tertiaires" target="_blank" class="btn btn-secondary">💰 CEE Coup de pouce</a>
        </div>
      </div>
    `;

    document.getElementById('resultsContent').innerHTML = html;
    setTimeout(() => {
      document.querySelectorAll('.chart-bar-fill').forEach(bar => { bar.style.width = bar.dataset.target; });
    }, 100);
  }

  // === Navigation ===
  function goToStep(n) {
    document.querySelectorAll('.step-panel').forEach(p => p.classList.remove('active'));
    document.getElementById('step' + n).classList.add('active');
    for (let i = 1; i <= 4; i++) {
      const ps = document.getElementById('ps' + i);
      ps.classList.remove('active', 'done');
      if (i < n) ps.classList.add('done');
      else if (i === n) ps.classList.add('active');
    }
    if (n >= 2) state.address = document.getElementById('addressInput').value;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function selectTile(group, el) {
    el.parentElement.querySelectorAll('.tile').forEach(t => t.classList.remove('selected'));
    el.classList.add('selected');
    if (group === 'buildingType') state.buildingType = el.dataset.type;
    if (group === 'collectif') state.collectif = el.dataset.collectif;
    if (group === 'energy') state.energy = el.dataset.energy;
    if (group === 'context') state.context = el.dataset.context;
  }

  function resetSim() {
    state.address = ''; state.lat = null; state.lon = null; state.inParis = null;
    state.buildingType = 'tertiaire'; state.collectif = 'oui';
    state.surface = null; state.puissance = null; state.conso = null; state.lots = null;
    state.energy = 'gaz'; state.context = 'remplacement';
    ['addressInput', 'surface', 'puissance', 'conso', 'lots'].forEach(id => { document.getElementById(id).value = ''; });
    document.getElementById('addrStatus').style.display = 'none';
    document.querySelectorAll('[data-type]')[0].click();
    document.querySelectorAll('[data-collectif]')[0].click();
    document.querySelectorAll('[data-energy]')[0].click();
    document.querySelectorAll('[data-context]')[0].click();
    goToStep(1);
  }

  // === Autocomplete BAN ===
  let abortController = null, debounceTimer = null;

  // Null-safe init: retries until the HtmlEmbed renders addressInput in the DOM
  (function initAutocomplete() {
    const addrInput = document.getElementById('addressInput');
    if (!addrInput) { setTimeout(initAutocomplete, 100); return; }
    addrInput.addEventListener('input', function() {
      const q = this.value.trim();
      if (q.length < 5) { hideDropdown(); return; }
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => fetchAddresses(q), 300);
    });
    document.addEventListener('click', e => { if (!e.target.closest('.autocomplete-wrapper')) hideDropdown(); });
  })();

  async function fetchAddresses(q) {
    if (abortController) abortController.abort();
    abortController = new AbortController();
    try {
      const res = await fetch(`https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(q)}&limit=6&type=housenumber`, { signal: abortController.signal });
      showDropdown((await res.json()).features || []);
    } catch (e) { if (e.name !== 'AbortError') hideDropdown(); }
  }

  function showDropdown(features) {
    const list = document.getElementById('autocompleteList');
    if (!features.length) { list.style.display = 'none'; return; }
    list.innerHTML = features.map(f => {
      const p = f.properties;
      return `<div class="autocomplete-item" onclick="selectAddress('${esc(p.label)}', ${f.geometry.coordinates[1]}, ${f.geometry.coordinates[0]}, '${esc(p.city || '')}')">
        <div class="main-text">${esc(p.label)}</div><div class="sub-text">${p.context || ''}</div>
      </div>`;
    }).join('');
    list.style.display = 'block';
  }

  function hideDropdown() { document.getElementById('autocompleteList').style.display = 'none'; }

  // ===== PROXIMITY CHECK — cascade : FCU API → Paris OpenData ZDP → fallback =====

  async function tryFCUApi(lat, lon) {
    // France Chaleur Urbaine public API — returns nearby networks with distance
    const urls = [
      `https://france-chaleur-urbaine.beta.gouv.fr/api/v1/network/search?lat=${lat}&lon=${lon}&distance=200`,
      `https://france-chaleur-urbaine.beta.gouv.fr/api/v1/networks/eligible?lat=${lat}&lon=${lon}&distance=200`,
      `https://france-chaleur-urbaine.beta.gouv.fr/api/v1/eligibility?lat=${lat}&lon=${lon}`,
    ];
    for (const url of urls) {
      try {
        const res = await fetch(url, {
          signal: AbortSignal.timeout(6000),
          headers: { Accept: 'application/json' }
        });
        if (!res.ok) continue;
        const data = await res.json();
        if (!Array.isArray(data)) continue;
        // Look for CPCU network (code 7501C) or any nearby network
        const cpcu = data.find(n =>
          (n.id || n.identifiant_reseau || n.code_reseau || n.code || '') === '7501C' ||
          (n.nom_reseau || n.nom || n.name || '').toLowerCase().includes('cpcu') ||
          (n.gestionnaire || '').toLowerCase().includes('cpcu')
        );
        const distM = cpcu
          ? (cpcu.distance_m ?? cpcu.distance ?? cpcu.dist ?? null)
          : (data.length > 0 ? Math.min(...data.map(n => n.distance_m ?? n.distance ?? n.dist ?? Infinity)) : null);
        return {
          nearNetwork: data.length > 0,
          hasCPCU: !!cpcu,
          inZDP: cpcu ? (distM !== null ? distM <= 60 : false) : false,
          distanceM: typeof distM === 'number' && isFinite(distM) ? Math.round(distM) : null,
          source: 'France Chaleur Urbaine',
          endpoint: url
        };
      } catch (e) { /* try next */ }
    }
    return null;
  }

  async function tryParisZDP(lat, lon) {
    // Paris OpenData — ZDP polygons for CPCU network (pre-computed 60m buffer)
    try {
      const url = `https://opendata.paris.fr/api/explore/v2.1/catalog/datasets/zonereseauchaleur/records?where=contains(geo_shape,geom'POINT(${lon} ${lat})')&limit=1`;
      const res = await fetch(url, {
        signal: AbortSignal.timeout(6000),
        headers: { Accept: 'application/json' }
      });
      if (!res.ok) return null;
      const data = await res.json();
      const inZDP = (data.total_count ?? 0) > 0;
      return {
        nearNetwork: inZDP,
        hasCPCU: inZDP,
        inZDP,
        distanceM: null, // not available from polygon containment
        source: 'OpenData Paris (ZDP)'
      };
    } catch (e) { return null; }
  }

  async function checkNetworkProximity(lat, lon) {
    const fcu = await tryFCUApi(lat, lon);
    if (fcu !== null) return fcu;
    const zdp = await tryParisZDP(lat, lon);
    if (zdp !== null) return zdp;
    return null; // both APIs unavailable
  }

  // Helper: build the proximity result block shown in results
  function buildProximityResultBlock(r) {
    const px = state.proximity;
    if (px === null) {
      return `<div class="distance-notice">
        <span class="dn-icon">📍</span>
        <span><strong>Proximité réseau : non vérifiée.</strong> Les deux APIs de vérification (France Chaleur Urbaine, OpenData Paris) n'ont pas répondu. <a href="https://france-chaleur-urbaine.beta.gouv.fr/carte" target="_blank">Vérifiez sur la carte →</a></span>
      </div>`;
    }
    if (px.inZDP) {
      const dist = px.distanceM !== null ? ` · Distance : ~${px.distanceM} m` : '';
      return `<div class="addr-status ok" style="margin-bottom:20px;">
        <span class="as-icon">✅</span>
        <span><strong>Dans la Zone de Développement Prioritaire CPCU</strong>${dist} · Raccordement potentiellement obligatoire lors du prochain renouvellement de chaudière collective.
        <br><span style="font-size:11px;opacity:0.8;">Source : ${px.source}</span></span>
      </div>`;
    }
    if (px.nearNetwork) {
      const dist = px.distanceM !== null ? ` (~${px.distanceM} m)` : '';
      return `<div class="addr-status warn" style="margin-bottom:20px;">
        <span class="as-icon">🟡</span>
        <span><strong>Proche d'un réseau CPCU${dist} mais hors ZDP directe</strong> · Raccordement non obligatoire mais techniquement possible. Une étude de faisabilité CPCU est recommandée.
        <br><span style="font-size:11px;opacity:0.8;">Source : ${px.source} · <a href="https://france-chaleur-urbaine.beta.gouv.fr/carte" target="_blank">Vérifier sur la carte →</a></span></span>
      </div>`;
    }
    return `<div class="addr-status no-net" style="margin-bottom:20px;">
      <span class="as-icon">🔴</span>
      <span><strong>Aucun réseau CPCU à proximité immédiate</strong> · L'adresse saisie ne semble pas dans la zone de desserte du réseau de chaleur parisien.
      <br><span style="font-size:11px;opacity:0.8;">Source : ${px.source} · <a href="https://france-chaleur-urbaine.beta.gouv.fr/carte" target="_blank">Consulter la carte nationale →</a></span></span>
    </div>`;
  }

  async function selectAddress(label, lat, lon, city) {
    document.getElementById('addressInput').value = label;
    state.address = label; state.lat = lat; state.lon = lon;
    state.inParis = city.toLowerCase().includes('paris');
    state.proximity = null; // reset previous result
    hideDropdown();
    const el = document.getElementById('addrStatus');
    // Step 1 — show loading state immediately
    el.style.display = 'flex';
    el.className = 'addr-status checking';
    el.innerHTML = `<span class="spin"></span> Vérification de la proximité au réseau CPCU en cours…`;

    // Step 2 — async proximity check
    const result = await checkNetworkProximity(lat, lon);
    state.proximity = result;

    // Step 3 — update UI with result
    if (result === null) {
      // Both APIs unavailable — fall back to Paris location heuristic
      el.className = state.inParis ? 'addr-status warn' : 'addr-status no-net';
      el.innerHTML = state.inParis
        ? `<span class="as-icon">⚠️</span><span><strong>Adresse dans Paris</strong> — Vérification de proximité au réseau indisponible (APIs FCU et OpenData Paris hors ligne). <a href="https://france-chaleur-urbaine.beta.gouv.fr/carte" target="_blank">Vérifiez sur la carte →</a></span>`
        : `<span class="as-icon">🌍</span><span><strong>Adresse hors Paris</strong> — Le réseau CPCU couvre principalement Paris intra-muros. <a href="https://france-chaleur-urbaine.beta.gouv.fr/carte" target="_blank">Voir les réseaux proches →</a></span>`;
    } else if (result.inZDP) {
      const dist = result.distanceM !== null ? ` · ~${result.distanceM} m du réseau` : '';
      el.className = 'addr-status ok';
      el.innerHTML = `<span class="as-icon">✅</span><span><strong>Dans la Zone de Développement Prioritaire CPCU</strong>${dist}. Raccordement potentiellement obligatoire. <small style="opacity:0.7">(${result.source})</small></span>`;
    } else if (result.nearNetwork) {
      const dist = result.distanceM !== null ? ` (~${result.distanceM} m)` : '';
      el.className = 'addr-status warn';
      el.innerHTML = `<span class="as-icon">🟡</span><span><strong>Proche d'un réseau${dist} mais hors ZDP directe</strong> — Raccordement possible sur demande. <a href="https://france-chaleur-urbaine.beta.gouv.fr/carte" target="_blank">Vérifier →</a> <small style="opacity:0.7">(${result.source})</small></span>`;
    } else {
      el.className = 'addr-status no-net';
      el.innerHTML = `<span class="as-icon">🔴</span><span><strong>Aucun réseau CPCU à proximité immédiate</strong> — Cette adresse n'est pas dans la zone de desserte directe. <a href="https://france-chaleur-urbaine.beta.gouv.fr/carte" target="_blank">Consulter la carte nationale →</a> <small style="opacity:0.7">(${result.source})</small></span>`;
    }
  }

  function esc(s) { return (s || '').replace(/'/g, "\\'").replace(/[<>]/g, ''); }

  // ===================================================================
  // MAKE (Integromat) webhook — CPCU Lead Ingestion
  // Scenario : Webhook → Zoho CRM Leads (create/update) → Slack #direction
  // ===================================================================
  const ZOHO_WEBHOOK_URL = 'https://hook.eu2.make.com/ri5a4cn8o72fsahex3icr5tay7jg1mnq';

  // Capture UTM params from current URL (works in Webflow)
  function getTracking() {
    try {
      const p = new URLSearchParams(window.location.search);
      return {
        gclid:        p.get('gclid')        || '',
        utm_source:   p.get('utm_source')   || '',
        utm_medium:   p.get('utm_medium')   || '',
        utm_campaign: p.get('utm_campaign') || '',
        utm_term:     p.get('utm_term')     || '',
        utm_content:  p.get('utm_content')  || '',
        landing_page: window.location.href  || '',
        click_date:   ''
      };
    } catch(e) { return {}; }
  }

  // Score d'éligibilité (0-100) pour le champ Score_Diagnostic Zoho
  function computeScore(eligStatus, inZDP) {
    if (eligStatus === 'eligible' && inZDP)   return 90;
    if (eligStatus === 'eligible')            return 70;
    if (eligStatus === 'convertible')         return 50;
    if (eligStatus === 'faible_puissance')    return 35;
    return 15; // hors_zone
  }

  const CONTEXT_LABEL = {
    remplacement: 'Remplacement chaudière',
    neuf:         'Bâtiment neuf',
    voluntaire:   'Démarche volontaire',
    info:         'Simple information'
  };
  const BUILDING_LABEL = {
    tertiaire:   'Bureau / Tertiaire',
    residentiel: 'Résidentiel collectif',
    hotel:       'Hôtel',
    sante:       'Santé / Éducation'
  };

  async function submitLead() {
    const prenom   = document.getElementById('lf_prenom').value.trim();
    const nom      = document.getElementById('lf_nom').value.trim();
    const email    = document.getElementById('lf_email').value.trim();
    const tel      = document.getElementById('lf_tel').value.trim();
    const societe  = document.getElementById('lf_societe').value.trim();
    const rgpd     = document.getElementById('lf_rgpd').checked;
    const statusEl = document.getElementById('leadFormStatus');
    const btn      = document.getElementById('leadSubmitBtn');

    // --- Validation ---
    if (!prenom || !nom || !email || !societe) {
      statusEl.style.display = 'block';
      statusEl.className = 'lead-form-status error';
      statusEl.textContent = '⚠️ Merci de renseigner les champs obligatoires (Prénom, Nom, Email, Société).';
      return;
    }
    if (!email.includes('@')) {
      statusEl.style.display = 'block';
      statusEl.className = 'lead-form-status error';
      statusEl.textContent = '⚠️ Adresse email invalide.';
      return;
    }
    if (!rgpd) {
      statusEl.style.display = 'block';
      statusEl.className = 'lead-form-status error';
      statusEl.textContent = '⚠️ Veuillez accepter la politique de confidentialité pour continuer.';
      return;
    }

    // --- Données simulation → champs Make blueprint ---
    let r = {};
    try { r = compute(); } catch(e) {}

    const P   = r.P   || 0;
    const C   = r.C   || 0;
    const elig = r.eligStatus || 'inconnu';
    const inZDP = !!(state.proximity?.inZDP);
    const proxLabel = state.proximity === null
      ? 'Non vérifié'
      : inZDP ? 'Dans la ZDP (raccordement obligatoire)'
      : state.proximity.nearNetwork ? `Proche réseau (~${state.proximity.distanceM ?? '?'} m)`
      : 'Hors zone réseau';

    // Payload aligné sur l'interface webhook Make "CPCU - Lead Ingestion"
    const payload = {
      // Champs contact plats — utilisés par le module createObject Zoho
      email:        email,
      first_name:   prenom,
      last_name:    nom,
      phone:        tel || '',
      company_name: societe,
      company_siret: '',   // non collecté dans ce simulateur

      // answers → construit la Description Zoho via le mapper Make
      answers: {
        sector:             BUILDING_LABEL[state.buildingType] || state.buildingType,
        energy_type:        ENERGY_LABEL[state.energy] || state.energy,
        contract_type:      CONTEXT_LABEL[state.context] || state.context,
        consumption:        C ? String(C) : '',         // MWh/an
        power_fit:          P ? `${P} kW — ${r.economies > 0 ? '+' + r.economies + ' €/an' : '—'}` : '',
        current_price:      r.totalRaccordement ? `Brut ${r.totalRaccordement.toLocaleString('fr-FR')} €HT / Net CEE ${r.netRaccordement?.toLocaleString('fr-FR') || '—'} €HT` : '',
        tax_exemptions:     r.ceeData?.amount ? `CEE Coup de pouce : ${r.ceeData.amount.toLocaleString('fr-FR')} € — ${r.ceeData.detail || ''}` : 'Non éligible',
        monitoring:         proxLabel,
        objective:          `CPCU [${elig}] — ${state.address || 'adresse non renseignée'}${state.lots ? ` — ${state.lots} lots` : ''}`,
        // champs sans équivalent CPCU → vides
        company_name:       societe,
        company_siret:      '',
        naf_code:           '',
        naf_libelle:        '',
        accise_eligibility: '',
        last_renewal:       '',
        email:              email
      },

      score:     computeScore(elig, inZDP),
      tracking:  getTracking(),
      timestamp: new Date().toISOString()
    };

    // --- Envoi vers Make ---
    btn.disabled = true;
    btn.innerHTML = `<span class="spin"></span> Envoi en cours…`;
    statusEl.style.display = 'none';

    try {
      const res = await fetch(ZOHO_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(12000)
      });
      if (!res.ok) throw new Error('Serveur a répondu ' + res.status);
      btn.style.display = 'none';
      statusEl.style.display = 'block';
      statusEl.className = 'lead-form-status success';
      statusEl.innerHTML = '✅ <strong>Demande envoyée !</strong> Un expert Cameleon Energies vous contactera sous 48h ouvrées.';
    } catch(e) {
      btn.disabled = false;
      btn.innerHTML = `<svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg> Envoyer ma demande`;
      statusEl.style.display = 'block';
      statusEl.className = 'lead-form-status error';
      statusEl.innerHTML = `❌ <strong>Erreur lors de l'envoi.</strong> Réessayez ou contactez-nous à <a href="mailto:contact@cameleon-energies.com">contact@cameleon-energies.com</a>.<br><em style="font-size:11px;opacity:0.75;">${e.message}</em>`;
    }
  }
