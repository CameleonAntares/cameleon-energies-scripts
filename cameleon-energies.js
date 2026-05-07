const CONFIG = {
    makeWebhookUrl: 'https://hook.eu2.make.com/2fjkmctycziiqfgp9ksgfxlh99s46g7p',
    earlyLeadWebhookUrl: 'https://hook.eu2.make.com/oil43jv4xlh94cy7mcajr9gfpii49vhm',
    sireneApiUrl: 'https://recherche-entreprises.api.gouv.fr/search'
};

// ── Mapping code NAF → éligibilité accise ─────────────────────────────────────
function getAcciseEligibility(nafCode) {
    if (!nafCode) return 'unknown';
    const prefix = parseInt(nafCode.substring(0, 2));
    if (prefix >= 1 && prefix <= 3)   return 'super_reduit'; // Agriculture, sylviculture, pêche
    if (prefix >= 5 && prefix <= 33)  return 'reduit';       // Industries extractives + manufacturières
    if (nafCode.startsWith('49.1') || nafCode.startsWith('49.2')) return 'reduit'; // Transport ferroviaire
    if (prefix >= 35 && prefix <= 39) return 'potentiel';    // Énergie, eau, déchets
    return 'standard';
}

// ── Résolution NAF depuis SIRET (API Sirene) ──────────────────────────────────
async function fetchCompanyNAF(siret) {
    if (!siret || siret.replace(/[\s\-]/g, '').length !== 14) return;
    try {
        const clean = siret.replace(/[\s\-]/g, '');
        const res = await fetch(`https://entreprise.data.gouv.fr/api/sirene/v3/etablissements/${clean}`);
        if (!res.ok) return;
        const data = await res.json();
        const etab = data.etablissement;
        if (!etab) return;
        answers.naf_code           = etab.activite_principale;
        answers.naf_libelle        = etab.libelle_section_activite_principale || null;
        answers.accise_eligibility = getAcciseEligibility(etab.activite_principale);
    } catch(e) { /* silencieux */ }
}

const questions = [
    {
        id: 'company', number: 1,
        title: '🏢 Votre entreprise',
        subtitle: 'Ces informations nous permettent de personnaliser votre diagnostic',
        type: 'company', required: false
    },
    {
        id: 'sector', number: 2,
        title: 'Quel est votre secteur d\'activité ?',
        subtitle: 'Certains secteurs bénéficient d\'exonérations fiscales spécifiques',
        type: 'radio',
        options: [
            { value: 'industrie', label: 'Industrie' },
            { value: 'commerce', label: 'Commerce / Retail' },
            { value: 'services', label: 'Services' },
            { value: 'hotellerie', label: 'Hôtellerie / Restauration' },
            { value: 'agriculture', label: 'Agriculture' },
            { value: 'autre', label: 'Autre' }
        ]
    },
    {
        id: 'consumption', number: 3,
        title: 'Quelle est votre consommation annuelle estimée ?',
        subtitle: 'Électricité et/ou gaz confondus',
        type: 'radio',
        options: [
            { value: '<100', label: 'Moins de 100 MWh' },
            { value: '100-500', label: '100 à 500 MWh' },
            { value: '500-1000', label: '500 à 1 000 MWh' },
            { value: '1000-5000', label: '1 000 à 5 000 MWh' },
            { value: '>5000', label: 'Plus de 5 000 MWh' },
            { value: 'ne_sais_pas', label: 'Je ne sais pas' }
        ]
    },
    {
        id: 'power_fit', number: 4,
        title: 'Votre puissance souscrite est-elle adaptée à votre consommation ?',
        subtitle: 'Vérifié par un expert ou sur la base de vos factures',
        type: 'radio',
        options: [
            { value: 'oui_pense', label: 'Oui, je le pense' },
            { value: 'non', label: 'Non' },
            { value: 'ne_sais_pas', label: 'Je ne sais pas' }
        ]
    },
    {
        id: 'energy_type', number: 5,
        title: 'Quel(s) type(s) d\'énergie utilisez-vous ?',
        subtitle: 'Sélectionnez votre situation',
        type: 'radio',
        options: [
            { value: 'electricite', label: 'Électricité uniquement' },
            { value: 'gaz', label: 'Gaz naturel uniquement' },
            { value: 'gaz_electricite', label: 'Gaz et électricité' }
        ]
    },
    {
        id: 'contract_type', number: 6,
        title: 'Quel est votre mode de fixation du prix ?',
        subtitle: 'Pour votre contrat principal',
        type: 'radio',
        options: [
            { value: 'fixe', label: 'Prix fixe' },
            { value: 'indexe', label: 'Prix indexé (marché)' },
            { value: 'bloc_spot', label: 'Bloc + Spot' },
            { value: 'cliquage', label: 'Cliquage (tranches)' },
            { value: 'ne_sais_pas', label: 'Je ne sais pas' }
        ]
    },
    {
        id: 'email', number: 7,
        title: '📧 Sauvegardez votre diagnostic',
        subtitle: 'Recevez vos résultats par email et continuez plus tard',
        type: 'email', required: true
    },
    {
        id: 'last_renewal', number: 8,
        title: 'Quand avez-vous renégocié vos contrats pour la dernière fois ?',
        subtitle: 'Les prix de l\'énergie évoluent constamment',
        type: 'radio',
        options: [
            { value: '<6mois', label: 'Moins de 6 mois' },
            { value: '6-12mois', label: '6 à 12 mois' },
            { value: '1-2ans', label: '1 à 2 ans' },
            { value: '>2ans', label: 'Plus de 2 ans' },
            { value: 'jamais', label: 'Jamais renégocié' },
            { value: 'ne_sais_pas', label: 'Je ne sais pas' }
        ]
    },
    {
        id: 'current_price', number: 9,
        title: 'Connaissez-vous votre prix actuel (€/MWh) ?',
        subtitle: 'Cette information se trouve sur votre facture',
        type: 'radio',
        options: [
            { value: 'oui_competitif', label: 'Oui, et je pense qu\'il est compétitif' },
            { value: 'oui_cher', label: 'Oui, et je pense qu\'il est élevé' },
            { value: 'non', label: 'Non, je ne connais pas mon prix' }
        ]
    },
    {
        id: 'tax_exemptions', number: 10,
        title: 'Bénéficiez-vous d\'exonérations fiscales ?',
        subtitle: null,
        type: 'radio',
        options: [
            { value: 'oui_toutes', label: 'Oui, de toutes celles auxquelles j\'ai droit' },
            { value: 'non', label: 'Non' },
            { value: 'ne_sais_pas', label: 'Je ne sais pas' }
        ]
    },
    {
        id: 'monitoring', number: 11,
        title: 'Avez-vous une personne dédiée à la veille tarifaire ?',
        subtitle: 'Suivre l\'évolution des prix est essentiel',
        type: 'radio',
        options: [
            { value: 'oui_temps_plein', label: 'Oui, à temps plein' },
            { value: 'oui_partiel', label: 'Oui, partiellement' },
            { value: 'moi_meme', label: 'Je le fais moi-même' },
            { value: 'non_pas_temps', label: 'Non, pas le temps' },
            { value: 'non_externalise', label: 'Non, je souhaite externaliser' }
        ]
    },
    {
        id: 'objective', number: 12,
        title: 'Quel est votre principal objectif ?',
        subtitle: 'Dernière question !',
        type: 'radio',
        options: [
            { value: 'reduire_couts', label: 'Réduire mes coûts' },
            { value: 'optimiser_fiscal', label: 'Optimiser ma fiscalité' },
            { value: 'securiser_prix', label: 'Sécuriser mes prix' },
            { value: 'gagner_temps', label: 'Gagner du temps' },
            { value: 'gerer_echeances', label: 'Gérer mes échéances et suivre mes contrats' },
            { value: 'tout', label: 'Tout ce qui précède' }
        ]
    }
];

let currentQuestion = 0;
let answers = {};

document.addEventListener('DOMContentLoaded', () => {
    renderQuestion(currentQuestion);
    setupCompanyAutocomplete();
    setupContactForm();
});

function renderQuestion(index) {
    const question = questions[index];
    const container = document.getElementById('questionContainer');
    let html = `<div class="question active">
        <div class="question-number">Question ${question.number}/${questions.length}</div>
        <h2 class="question-title">${question.title}</h2>
        ${question.subtitle ? `<p class="question-subtitle">${question.subtitle}</p>` : ''}`;

    if (question.type === 'email') {
        html += `<div class="email-capture">
            <h3>💾 Ne perdez pas vos réponses !</h3>
            <p>Entrez votre email pour sauvegarder votre progression</p>
            <div class="form-group">
                <input type="email" id="emailInput" placeholder="votre@email.com" style="border:2px solid white;">
                <div class="error-message" id="emailError">Veuillez entrer un email valide</div>
            </div>
        </div>`;
    } else if (question.type === 'company') {
        html += `<div class="form-group autocomplete-container">
            <label>Nom de votre entreprise ou SIRET</label>
            <input type="text" id="companySearchQ" placeholder="Ex: Caméléon Energies ou 123456789" autocomplete="off"
                   value="${answers.company_name || ''}">
            <div class="autocomplete-results" id="autocompleteResultsQ"></div>
            <input type="hidden" id="siretQ" value="${answers.company_siret || ''}">
            <p style="font-size:13px;color:#888;margin-top:8px;">
                Ces informations sont facultatives et restent confidentielles.
            </p>
        </div>`;
    } else if (question.type === 'radio' || question.type === 'checkbox') {
        html += '<div class="options-grid">';
        question.options.forEach((option, i) => {
            const inputType = question.type === 'checkbox' ? 'checkbox' : 'radio';
            const checked = answers[question.id]?.includes(option.value) ? 'checked' : '';
            html += `<div class="option-card">
                <input type="${inputType}" id="${question.id}_${i}" name="${question.id}" value="${option.value}" ${checked}>
                <label for="${question.id}_${i}">${option.label}</label>
            </div>`;
        });
        html += '</div>';
    }

    html += `<div class="button-group">
        ${index > 0 ? '<button type="button" class="btn-secondary" onclick="previousQuestion()">← Précédent</button>' : '<div></div>'}
        <button type="button" class="btn-primary" onclick="nextQuestion()">
            ${index === questions.length - 1 ? 'Voir mes résultats →' : 'Suivant →'}
        </button>
    </div></div>`;

    container.innerHTML = html;
    updateProgress();
}

function nextQuestion() {
    const question = questions[currentQuestion];

    if (question.type === 'email') {
        const email = document.getElementById('emailInput').value;
        if (!validateEmail(email)) {
            document.getElementById('emailError').classList.add('show');
            document.getElementById('emailInput').classList.add('error');
            return;
        }
        answers[question.id] = email;
        // ── WEBHOOK 2 : email capturé + tout le contexte Q1-Q6 ──
        sendEmailLead();
    } else if (question.type === 'radio') {
        const selected = document.querySelector(`input[name="${question.id}"]:checked`);
        if (!selected && question.required) return;
        if (selected) answers[question.id] = selected.value;
    } else if (question.type === 'checkbox') {
        const selected = Array.from(document.querySelectorAll(`input[name="${question.id}"]:checked`)).map(el => el.value);
        if (selected.length === 0 && question.required) return;
        answers[question.id] = selected;
    } else if (question.type === 'company') {
        const company = document.getElementById('companySearchQ').value.trim();
        const siret   = document.getElementById('siretQ').value.trim();
        answers.company_name = company;
        answers.company_siret = siret;
        // ── ENVOI ANTICIPÉ DU LEAD après confirmation entreprise ──
        sendEarlyLead();
    }

    if (currentQuestion < questions.length - 1) {
        currentQuestion++;
        renderQuestion(currentQuestion);
    } else {
        showResults();
    }
}

// ── Webhook 1 (lead_step1) : dès validation Q1 — pas d'email à ce stade ──────
async function sendEarlyLead() {
    const payload = {
        event: 'lead_step1',
        company_name:        answers.company_name  || null,
        company_siret:       answers.company_siret || null,
        naf_code:            answers.naf_code      || null,
        questions_completed: currentQuestion + 1,
        total_questions:     questions.length,
        timestamp:           new Date().toISOString()
    };
    try {
        await fetch(CONFIG.earlyLeadWebhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
    } catch (_) { /* silencieux — ne pas bloquer le formulaire */ }
}

// ── Webhook 2 (lead_email) : dès validation Q7 — email + tout le contexte ────
async function sendEmailLead() {
    const payload = {
        event: 'lead_email',
        email:               answers.email         || null,
        company_name:        answers.company_name  || null,
        company_siret:       answers.company_siret || null,
        naf_code:            answers.naf_code      || null,
        sector:              answers.sector        || null,
        consumption:         answers.consumption   || null,
        energy_type:         answers.energy_type   || null,
        contract_type:       answers.contract_type || null,
        power_fit:           answers.power_fit     || null,
        questions_completed: currentQuestion + 1,
        total_questions:     questions.length,
        timestamp:           new Date().toISOString()
    };
    try {
        await fetch(CONFIG.earlyLeadWebhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
    } catch (_) { /* silencieux — ne pas bloquer le formulaire */ }
}

function previousQuestion() {
    if (currentQuestion > 0) { currentQuestion--; renderQuestion(currentQuestion); }
}

function updateProgress() {
    const progress = ((currentQuestion + 1) / questions.length) * 100;
    document.getElementById('progressFill').style.width = progress + '%';
    document.getElementById('progressText').textContent = `Question ${currentQuestion + 1} sur ${questions.length}`;
}

function validateEmail(email) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email); }

// ===== CALCUL SCORE & RECOMMANDATIONS ENRICHIES =====
function calculateScore() {
    let score = 100;
    const recommendations = [];

    // ── Puissance souscrite (Q4) ───────────────────────────────────────────────
    if (answers.power_fit === 'non') {
        score -= 15;
        recommendations.push({
            title: '🔴 Puissance mal adaptée — surcoût probable',
            text: "Une puissance souscrite trop élevée génère des frais fixes inutiles (terme puissance, tarif TURPE). Trop basse, elle expose à des dépassements tarifés. Un audit de puissance prend moins d'une heure.",
            saving: estimateSaving(5, 15)
        });
    } else if (answers.power_fit === 'ne_sais_pas') {
        score -= 8;
        recommendations.push({
            title: '🟠 Puissance souscrite — à vérifier',
            text: "La puissance souscrite est souvent définie à l'ouverture du contrat et jamais réévaluée, même lorsque les usages évoluent. Notre intervention repose sur une analyse rigoureuse : en interrogeant directement ENEDIS, nous consultons l'historique de consommation des 24 à 36 derniers mois pour comparer la puissance réellement appelée à la puissance souscrite. Cette lecture précise permet de détecter un surdimensionnement éventuel et d'engager les ajustements qui s'imposent.",
            saving: null
        });
    }

    // ── Renouvellement contrat (Q8) ────────────────────────────────────────────
    if (answers.last_renewal === 'jamais') {
        score -= 25;
        recommendations.push({
            title: '🔴 Contrat jamais renégocié — risque maximal',
            text: "Un contrat établi sans négociation active n'est, par définition, jamais calibré aux conditions réelles du marché. Il ne bénéficie d'aucune des optimisations accessibles à ceux qui pilotent leur achat avec méthode. Les fournisseurs n'ajustent pas spontanément leurs tarifs à la baisse. Se faire accompagner par un expert garantit de profiter de conditions avantageuses et de conseils avisés pour prendre la bonne décision.",
            saving: estimateSaving(15, 25)
        });
    } else if (answers.last_renewal === '>2ans') {
        score -= 20;
        recommendations.push({
            title: '🟠 Renégociation en retard (+2 ans)',
            text: "Les prix de l'énergie ont connu des variations considérables sur les cinq dernières années. Selon la date et les conditions de signature de votre contrat actuel, vous vous trouvez peut-être dans une fenêtre de tir intéressante pour profiter des niveaux de marché actuels. C'est précisément ce que nous évaluons pour vous.",
            saving: estimateSaving(10, 20)
        });
    } else if (answers.last_renewal === '1-2ans') {
        score -= 10;
        recommendations.push({
            title: '🟡 Contrat à surveiller (1-2 ans)',
            text: "Votre contrat approche de la fenêtre idéale pour agir. Contrairement aux idées reçues, il n'est pas nécessaire d'attendre l'échéance : les marchés de l'énergie offrent la possibilité de sécuriser ses achats jusqu'à 36 mois à l'avance, permettant ainsi de lisser les pics de volatilité et de maîtriser son budget sur le long terme.",
            saving: null
        });
    } else if (answers.last_renewal === 'ne_sais_pas') {
        score -= 12;
        recommendations.push({
            title: '🟠 Date de renégociation inconnue — risque de hors-marché',
            text: "Ne pas connaître la date de votre dernière renégociation est souvent le signe que la gestion énergétique n'est pas formalisée. Retrouvez cette date sur votre contrat ou facture — elle conditionne toute votre stratégie d'achat.",
            saving: null
        });
    }

    // ── Prix actuel (Q9) ───────────────────────────────────────────────────────
    if (answers.current_price === 'non') {
        score -= 20;
        recommendations.push({
            title: '🔴 Prix inconnu — angle mort critique',
            text: "Ne pas connaître son prix unitaire d'énergie est le premier obstacle à toute démarche d'optimisation. Ce chiffre figure sur vos factures, généralement dans la ligne dédiée à la fourniture d'énergie — mais le repérer n'est pas toujours aisé. Chaque fournisseur adopte sa propre présentation : certains intègrent des taxes dans le prix affiché, d'autres changent l'unité de mesure, expriment le prix en centimes d'euro par kWh ou en €/kWh plutôt qu'en €/MWh. Cette opacité est rarement fortuite. Nous savons lire ces factures, et nous le faisons pour vous.",
            saving: null
        });
    } else if (answers.current_price === 'oui_cher') {
        score -= 15;
        recommendations.push({
            title: '🟠 Prix jugé élevé — action possible',
            text: "Votre perception est souvent juste. Une consultation de marché permettra de quantifier précisément l'écart avec les offres compétitives actuelles et d'obtenir des alternatives concrètes.",
            saving: estimateSaving(10, 20)
        });
    }

    // ── Accise sur l'énergie (Q10) — logique enrichie via NAF ─────────────────
    const eligibility = answers.accise_eligibility || 'unknown';
    const nafCode     = answers.naf_code    || null;
    const nafLabel    = answers.naf_libelle || null;
    const nafDisplay  = nafCode ? ` (code NAF ${nafCode}${nafLabel ? ' — ' + nafLabel : ''})` : '';

    if (answers.tax_exemptions === 'non') {
        score -= 20;
        if (eligibility === 'super_reduit') {
            recommendations.push({
                title: '🔴 Accise — taux super-réduit probablement applicable',
                text: `Votre secteur d'activité${nafDisplay} est éligible à un taux d'accise sur l'énergie significativement réduit, réservé aux activités agricoles, sylvicoles et aquacoles. Si ce taux n'est pas appliqué sur vos factures actuelles, vous payez trop depuis le premier jour. Une étude approfondie de votre dossier — incluant bilans comptables et analyse des usages — est nécessaire pour en établir l'éligibilité formelle, initier la régularisation et récupérer d'éventuels trop-perçus sur les exercices passés.`,
                saving: estimateSaving(8, 15)
            });
        } else if (eligibility === 'reduit') {
            recommendations.push({
                title: '🔴 Accise — taux réduit industriel probablement applicable',
                text: `Votre secteur d'activité${nafDisplay} entre dans le périmètre des activités industrielles et extractives pour lesquelles la réglementation prévoit un taux d'accise réduit sur l'énergie. Si ce régime n'est pas activé sur vos contrats actuels, vous supportez un surcoût fiscal injustifié. Déterminer précisément votre éligibilité requiert une étude sérieuse de votre dossier : bilan comptable, nature et intensité des process consommateurs, volumes par site. Nous conduisons cette analyse dans les règles de l'art et accompagnons, le cas échéant, la constitution du dossier de remboursement.`,
                saving: estimateSaving(8, 15)
            });
        } else if (eligibility === 'potentiel') {
            recommendations.push({
                title: '🟠 Accise — éligibilité à expertiser',
                text: `Votre secteur d'activité${nafDisplay} peut, selon l'intensité réelle de vos consommations et la nature de vos process, ouvrir droit à un régime d'accise allégé. Ce point mérite une analyse rigoureuse : l'éligibilité dépend de critères précis — part de l'énergie dans la valeur ajoutée, nature des installations — qui ne peuvent être établis sans étude de dossier. Nous conduisons cette analyse et accompagnons, le cas échéant, la constitution de la demande de remboursement.`,
                saving: estimateSaving(5, 12)
            });
        } else {
            recommendations.push({
                title: "🔴 Accise sur l'énergie non optimisée — économies possibles",
                text: "L'accise sur l'énergie (anciennement TICFE pour l'électricité, TICGN pour le gaz) est l'un des principaux leviers fiscaux accessibles aux entreprises. Son taux peut varier significativement selon votre secteur d'activité et votre niveau de consommation. En déterminer l'éligibilité nécessite une étude sérieuse de votre dossier : bilan comptable, nature des activités, volumes consommés. Nous conduisons cette analyse dans les règles de l'art, et accompagnons le cas échéant la constitution du dossier de remboursement.",
                saving: estimateSaving(8, 15)
            });
        }
    } else if (answers.tax_exemptions === 'ne_sais_pas') {
        score -= 15;
        if (eligibility === 'super_reduit' || eligibility === 'reduit') {
            recommendations.push({
                title: "🟠 Accise — votre secteur est probablement éligible à un taux réduit",
                text: `Bonne nouvelle : votre secteur d'activité${nafDisplay} figure parmi ceux pour lesquels la réglementation prévoit un taux d'accise sur l'énergie réduit. Ce régime, souvent ignoré, peut représenter une économie réelle sur vos factures. Encore faut-il que votre dossier soit constitué et déposé dans les formes : bilan comptable, justification des activités, volumes par site. C'est un vrai travail d'expert — et nous le menons à votre place.`,
                saving: null
            });
        } else {
            recommendations.push({
                title: "🟠 Accise sur l'énergie — statut à clarifier",
                text: "L'accise sur l'énergie reste méconnue, alors qu'elle peut représenter une part significative de votre facture. Selon votre secteur d'activité et votre niveau de consommation, vous pourriez bénéficier d'un taux réduit ou d'une exonération — deux régimes distincts, aux conditions et aux impacts différents. En déterminer l'éligibilité nécessite une étude sérieuse de votre dossier : bilan comptable, nature des activités, volumes consommés. Nous conduisons cette analyse dans les règles de l'art, et accompagnons le cas échéant la constitution du dossier de remboursement.",
                saving: null
            });
        }
    }

    // ── Veille tarifaire (Q11) ─────────────────────────────────────────────────
    if (answers.monitoring === 'non_pas_temps') {
        score -= 15;
        recommendations.push({
            title: '🟠 Pas de veille tarifaire — opportunités manquées',
            text: "Les fenêtres d'achat favorables sur le marché de l'énergie peuvent se refermer en moins de 48 heures. Sans une présence continue sur le marché, on signe souvent au mauvais moment — sans même le savoir. Nos experts sont connectés aux marchés à longueur de journée. C'est cette vigilance permanente qui permet de saisir les opportunités au bon moment, et non de les constater après coup.",
            saving: null
        });
    } else if (answers.monitoring === 'moi_meme') {
        score -= 8;
        recommendations.push({
            title: '🟡 Veille en solo — risque de manquer les fenêtres',
            text: "Assurer soi-même une veille efficace sur les marchés de l'énergie demande bien plus qu'une consultation quotidienne des prix. La plupart des acteurs qui s'y risquent regardent les mauvais indicateurs : ils suivent les prix immédiats alors que les décisions d'achat se prennent sur les marchés à terme, ils s'intéressent aux mauvaises années calendaires, et interprètent des signaux qui ne reflètent pas leur situation réelle. La gestion active d'un portefeuille d'énergie est un métier — et le confier à un expert, c'est précisément éviter ces erreurs de lecture.",
            saving: null
        });
    } else if (answers.monitoring === 'non_externalise') {
        score -= 5;
        recommendations.push({
            title: "🟢 Bonne intuition sur l'externalisation",
            text: "Externaliser la veille énergétique est la décision la plus rentable pour la plupart des PME. Un expert en achat d'énergie actif surveille les indices (PEG, EEX, Epex Spot) en temps réel et vous alerte au moment optimal.",
            saving: null
        });
    }

    // ── Mode de fixation du prix (Q6) ─────────────────────────────────────────
    if (answers.contract_type === 'ne_sais_pas') {
        score -= 10;
        recommendations.push({
            title: '🟠 Mode de fixation inconnu — choisir la bonne formule peut changer la donne',
            text: "Chaque mécanisme répond à une logique différente : le prix fixe apporte de la visibilité budgétaire ; le prix indexé suit le marché et peut être avantageux en période de baisse ; le bloc + spot combine sécurité et flexibilité ; le cliquage permet d'acheter par tranches au moment le plus opportun. Le bon choix dépend de vos habitudes de consommation et de votre appétence au risque — c'est précisément ce sur quoi nous pouvons vous aider à trancher ensemble.",
            saving: null
        });
    } else if (answers.contract_type === 'fixe' && (answers.last_renewal === '>2ans' || answers.last_renewal === 'jamais')) {
        recommendations.push({
            title: '💡 Contrat fixe signé en période de prix hauts',
            text: "Le marché de l'énergie a profondément évolué ces dernières années, et dans la grande majorité des situations que nous analysons, nos acheteurs identifient des opportunités significativement plus favorables que les conditions actuellement en cours. Ce qui change tout : ces prix peuvent être sécurisés dès aujourd'hui, pour prendre effet à l'échéance de votre contrat en cours. N'attendez pas la fin de votre contrat pour agir. Le bon moment pour préparer la suite, c'est maintenant, pendant que le marché vous y invite.",
            saving: null
        });
    }

    // ── Consommation (Q3) ─────────────────────────────────────────────────────
    if (answers.consumption === 'ne_sais_pas') {
        score -= 8;
        recommendations.push({
            title: '🟠 Consommation inconnue — point de départ essentiel',
            text: "La consommation annuelle est le point de départ de toute stratégie d'achat d'énergie. Le détail mensuel figure sur vos factures — mais notre lien privilégié avec ENEDIS nous permet d'aller bien plus loin : nous accédons directement à vos données de consommation et pouvons en reconstituer le profil avec une granularité jusqu'à la minute, pour bâtir une stratégie d'achat réellement adaptée à vos usages.",
            saving: null
        });
    } else if ((answers.consumption === '>5000' || answers.consumption === '1000-5000') && score < 75) {
        recommendations.push({
            title: "📊 Volume élevé : priorité absolue à l'optimisation",
            text: "Au-delà de 1 000 MWh/an, chaque euro de réduction sur votre €/MWh se traduit par des milliers d'euros d'économies annuelles. Une négociation structurée avec plusieurs fournisseurs est indispensable.",
            saving: estimateSaving(20, 40)
        });
    }

    // ── Score élevé ───────────────────────────────────────────────────────────
    if (score >= 85) {
        recommendations.push({
            title: '✅ Bonne maîtrise de votre stratégie énergétique',
            text: "Vos pratiques d'achat énergétique sont solides. Un audit de confirmation permettrait néanmoins d'identifier les 5 à 10% d'optimisation résiduelle accessibles.",
            saving: null
        });
    }

    // ── Message pédagogue si >= 3 réponses "je ne sais pas" ───────────────────
    const dontKnowCount = Object.values(answers).filter(v => v === 'ne_sais_pas').length;
    if (dontKnowCount >= 3) {
        recommendations.unshift({
            title: "ℹ️ Pas d'inquiétude, vous êtes en bonne compagnie",
            text: "La plupart des dirigeants et responsables que nous accompagnons n'ont pas de réponse immédiate à ces questions — et c'est tout à fait normal. La gestion de l'énergie est un métier à part entière, avec ses propres marchés, sa fiscalité, ses mécanismes de prix. Ce n'est pas votre cœur de métier, et ce n'est pas censé l'être.\n\nC'est pourquoi nous prenons ce sujet en main à votre place. En pratique, nos clients consacrent en moyenne 6 minutes à nous transmettre leurs documents, 12 minutes à échanger avec leur acheteur dédié, et une quinzaine de minutes à relire avec nous puis signer un contrat qui sécurise leur énergie pour les années à venir. Ensuite, nous restons présents : un point de suivi tous les six mois pour s'assurer que votre stratégie reste alignée avec les évolutions du marché. Tout cela, sans jargon et sans frais. Nous sommes rémunérés par le fournisseur à hauteur du volume d'affaires que nous lui apportons.",
            saving: null
        });
    }

    return { score: Math.max(score, 0), recommendations };
}
function estimateSaving(minPct, maxPct) {
    const consumptionMap = { '<100': 50, '100-500': 300, '500-1000': 750, '1000-5000': 3000, '>5000': 7500 };
    const mwh = consumptionMap[answers.consumption] || 300;
    const avgPrice = 150; // €/MWh baseline
    const minSaving = Math.round(mwh * avgPrice * (minPct / 100) / 100) * 100;
    const maxSaving = Math.round(mwh * avgPrice * (maxPct / 100) / 100) * 100;
    return `Économies estimées : ${minSaving.toLocaleString('fr-FR')}€ à ${maxSaving.toLocaleString('fr-FR')}€/an`;
}

function showResults() {
    document.getElementById('loading').classList.add('active');
    document.getElementById('questionContainer').style.display = 'none';

    setTimeout(() => {
        const { score, recommendations } = calculateScore();
        document.getElementById('loading').classList.remove('active');
        document.getElementById('resultsContainer').classList.add('active');

        animateScore(score);

        let recoHtml = '<h3>🎯 Vos recommandations personnalisées</h3>';
        recommendations.forEach((reco, i) => {
            recoHtml += `<div class="recommendation-item">
                <div class="recommendation-icon">${i + 1}</div>
                <div class="recommendation-content">
                    <div class="recommendation-title">${reco.title}</div>
                    <div class="recommendation-text">${reco.text}</div>
                    ${reco.saving ? `<span class="recommendation-saving">💰 ${reco.saving}</span>` : ''}
                </div>
            </div>`;
        });
        document.getElementById('recommendations').innerHTML = recoHtml;

        let label = '';
        if (score >= 85) label = 'Bonne maîtrise énergétique 👍';
        else if (score >= 65) label = 'Des optimisations sont accessibles';
        else if (score >= 40) label = 'Potentiel d\'économies important';
        else label = 'Optimisation urgente recommandée 🚨';
        document.getElementById('scoreLabel').textContent = label;
    }, 2000);
}

function animateScore(targetScore) {
    const scoreEl = document.getElementById('scoreNumber');
    const circle = document.getElementById('scoreCircle');
    const circumference = 2 * Math.PI * 90;
    const offset = circumference - (targetScore / 100) * circumference;

    let current = 0;
    const increment = targetScore / 50;
    const timer = setInterval(() => {
        current += increment;
        if (current >= targetScore) { current = targetScore; clearInterval(timer); }
        scoreEl.textContent = Math.round(current);
    }, 30);

    setTimeout(() => {
        circle.style.strokeDashoffset = offset;
        if (targetScore >= 80) circle.style.stroke = '#27AE60';
        else if (targetScore >= 60) circle.style.stroke = '#F39C12';
        else circle.style.stroke = '#E74C3C';
    }, 100);
}

// ===== CALENDLY =====
    document.body.style.overflow = 'hidden';
}
    document.body.style.overflow = '';
}
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeCalendly(); });

// ===== AUTOCOMPLETE SIRENE =====
let autocompleteTimeout;
function setupCompanyAutocomplete() {
    // Autocomplete pour la question entreprise (Q1)
    document.addEventListener('input', (e) => {
        if (e.target.id === 'companySearchQ') {
            clearTimeout(autocompleteTimeout);
            const query = e.target.value.trim();
            const rc = document.getElementById('autocompleteResultsQ');
            if (!rc) return;
            if (query.length < 3) { rc.classList.remove('show'); return; }
            autocompleteTimeout = setTimeout(() => searchCompanies(query, 'autocompleteResultsQ'), 300);
        }
    });
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.autocomplete-container')) {
            document.querySelectorAll('.autocomplete-results').forEach(r => r.classList.remove('show'));
        }
    });
}

async function searchCompanies(query, containerId = 'autocompleteResultsQ') {
    const resultsContainer = document.getElementById(containerId);
    if (!resultsContainer) return;
    try {
        const response = await fetch(`${CONFIG.sireneApiUrl}?q=${encodeURIComponent(query)}&per_page=5`);
        const data = await response.json();
        if (data.results && data.results.length > 0) {
            let html = '';
            data.results.forEach(company => {
                const name = company.nom_complet || company.nom_raison_sociale || 'Entreprise';
                const siret = company.siege?.siret || company.siret || '';
                const city = company.siege?.libelle_commune || '';
                const numVoie = company.siege?.numero_voie || '';
                const typeVoie = company.siege?.type_voie || '';
                const libelleVoie = company.siege?.libelle_voie || '';
                const rue = [numVoie, typeVoie, libelleVoie].filter(Boolean).join(' ');
                const adresse = [rue, city].filter(Boolean).join(' — ');
                html += `<div class="autocomplete-item" onclick="selectCompany('${siret}', '${name.replace(/'/g, "\\'")}')">
                    <strong>${name}</strong>
                    <small>${siret}${adresse ? ' · ' + adresse : ''}</small>
                </div>`;
            });
            resultsContainer.innerHTML = html;
            resultsContainer.classList.add('show');
        } else {
            resultsContainer.innerHTML = '<div class="autocomplete-item"><small>Aucune entreprise trouvée</small></div>';
            resultsContainer.classList.add('show');
        }
    } catch (error) { resultsContainer.classList.remove('show'); }
}

function selectCompany(siret, name) {
    const inp = document.getElementById('companySearchQ');
    const sir = document.getElementById('siretQ');
    const rc  = document.getElementById('autocompleteResultsQ');
    if (inp) inp.value = name;
    if (sir) sir.value = siret;
    if (rc)  rc.classList.remove('show');
    // Résoudre le NAF dès que le SIRET est connu
    if (siret) fetchCompanyNAF(siret);
}

// ===== CONTACT FORM =====
function setupContactForm() {
    document.getElementById('contactForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const formData = {
            email: answers.email,
            company_name: answers.company_name || null,
            company_siret: answers.company_siret || null,
            first_name: document.getElementById('firstName').value,
            last_name: document.getElementById('lastName').value,
            phone: document.getElementById('phone').value,
            answers: answers,
            score: calculateScore().score,
            timestamp: new Date().toISOString()
        };
        try {
            const response = await fetch(CONFIG.makeWebhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formData)
            });
            if (response.ok) {
                alert('✅ Merci ! Notre équipe vous contactera dans les plus brefs délais.');
            } else { throw new Error(); }
        } catch (error) {
            alert('❌ Une erreur est survenue. Veuillez réessayer ou nous contacter directement.');
        }
    });
}
