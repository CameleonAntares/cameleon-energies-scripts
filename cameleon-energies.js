// ===== CONFIGURATION =====
const CONFIG = {
    makeWebhookUrl: 'https://hook.eu2.make.com/YOUR_WEBHOOK_HERE',
    earlyLeadWebhookUrl: 'https://hook.eu2.make.com/YOUR_EARLY_LEAD_WEBHOOK_HERE',
    inseeApiUrl: 'https://entreprise.data.gouv.fr/api/sirene/v3'
};

// ===== STATE =====
let currentQuestion = 1;
const totalQuestions = 12;
const answers = {};
let companies = [];
let abortController = null;
let debounceTimer = null;

// ===== NAF → ACCISE MAPPING =====
function getAcciseEligibility(nafCode) {
    if (!nafCode) return 'unknown';
    const prefix = nafCode.substring(0, 2);
    
    // Super-réduit : agriculture, sylviculture, aquaculture (01, 02, 03)
    if (['01', '02', '03'].includes(prefix)) return 'super_reduit';
    
    // Réduit : extraction, industries manufacturières, transports (05-33, 49.1-49.2)
    if ((parseInt(prefix) >= 5 && parseInt(prefix) <= 33) || nafCode.startsWith('49.1') || nafCode.startsWith('49.2')) {
        return 'reduit';
    }
    
    // Potentiel : production/distribution énergie, eau (35-39)
    if (parseInt(prefix) >= 35 && parseInt(prefix) <= 39) return 'potentiel';
    
    return 'standard';
}

// ===== INSEE API =====
async function searchCompanies(query) {
    if (abortController) abortController.abort();
    abortController = new AbortController();

    try {
        const response = await fetch(
            `${CONFIG.inseeApiUrl}/unites_legales?q=${encodeURIComponent(query)}&per_page=10`,
            { signal: abortController.signal }
        );

        if (!response.ok) {
            if (response.status === 429) {
                console.warn('Rate limit hit — retry in 1s');
                await new Promise(r => setTimeout(r, 1000));
                return searchCompanies(query);
            }
            throw new Error(`API error: ${response.status}`);
        }

        const data = await response.json();
        companies = (data.unite_legale || []).map(ul => {
            const siege = ul.siege || {};
            return {
                siren: ul.siren,
                siret: siege.siret,
                nom: ul.denomination || ul.nom_complet || 'Entreprise sans nom',
                adresse: [
                    siege.numero_voie,
                    siege.type_voie,
                    siege.libelle_voie,
                    siege.code_postal,
                    siege.libelle_commune
                ].filter(Boolean).join(' ').trim() || 'Adresse non disponible'
            };
        });

        displaySuggestions();
    } catch (error) {
        if (error.name !== 'AbortError') {
            console.error('Search error:', error);
            companies = [];
            displaySuggestions();
        }
    }
}

function displaySuggestions() {
    const list = document.getElementById('companySuggestions');
    if (!companies.length) {
        list.classList.remove('active');
        return;
    }

    list.innerHTML = companies.map((c, idx) => `
        <div class="autocomplete-item" onclick="selectCompany(${idx})">
            <div><strong>${c.nom}</strong></div>
            <small>SIRET: ${c.siret} • ${c.adresse}</small>
        </div>
    `).join('');
    list.classList.add('active');
}

async function selectCompany(index) {
    const company = companies[index];
    document.getElementById('company').value = company.nom;
    document.getElementById('companySuggestions').classList.remove('active');
    
    answers.company_name = company.nom;
    answers.company_siret = company.siret;

    await fetchCompanyNAF(company.siret);
}

async function fetchCompanyNAF(siret) {
    try {
        const response = await fetch(`${CONFIG.inseeApiUrl}/etablissements/${siret}`);
        if (!response.ok) throw new Error(`API error: ${response.status}`);

        const data = await response.json();
        const etablissement = data.etablissement || {};
        const nafCode = etablissement.activite_principale || null;
        const nafLibelle = etablissement.libelle_activite_principale || null;

        answers.naf_code = nafCode;
        answers.naf_libelle = nafLibelle;
        answers.accise_eligibility = getAcciseEligibility(nafCode);

        console.log(`NAF: ${nafCode} (${nafLibelle}) → Accise: ${answers.accise_eligibility}`);
    } catch (error) {
        console.error('NAF fetch error:', error);
        answers.naf_code = null;
        answers.naf_libelle = null;
        answers.accise_eligibility = 'unknown';
    }
}

function handleCompanyInput(event) {
    const value = event.target.value.trim();
    
    clearTimeout(debounceTimer);
    
    if (value.length < 3) {
        companies = [];
        document.getElementById('companySuggestions').classList.remove('active');
        return;
    }

    debounceTimer = setTimeout(() => searchCompanies(value), 600);
}

document.addEventListener('click', (e) => {
    if (!e.target.closest('.autocomplete-wrapper')) {
        document.getElementById('companySuggestions').classList.remove('active');
    }
});

// ===== WEBHOOKS =====
async function sendEarlyLead() {
    if (!CONFIG.earlyLeadWebhookUrl || CONFIG.earlyLeadWebhookUrl.includes('YOUR_')) return;

    const payload = {
        event: 'lead_step1',
        company_name: answers.company_name || null,
        company_siret: answers.company_siret || null,
        naf_code: answers.naf_code || null,
        questions_completed: 1,
        timestamp: new Date().toISOString()
    };

    try {
        await fetch(CONFIG.earlyLeadWebhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        console.log('Early lead sent');
    } catch (error) {
        console.error('Early lead webhook error:', error);
    }
}

async function sendEmailLead() {
    if (!CONFIG.earlyLeadWebhookUrl || CONFIG.earlyLeadWebhookUrl.includes('YOUR_')) return;

    const payload = {
        event: 'lead_email',
        email: answers.email || null,
        company_name: answers.company_name || null,
        company_siret: answers.company_siret || null,
        naf_code: answers.naf_code || null,
        sector: answers.sector || null,
        consumption: answers.consumption || null,
        energy_type: answers.energy_type || null,
        contract_type: answers.contract_type || null,
        power_fit: answers.power_fit || null,
        questions_completed: 7,
        timestamp: new Date().toISOString()
    };

    try {
        await fetch(CONFIG.earlyLeadWebhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        console.log('Email lead sent');
    } catch (error) {
        console.error('Email lead webhook error:', error);
    }
}

async function sendFinalWebhook(score, recommendations) {
    if (!CONFIG.makeWebhookUrl || CONFIG.makeWebhookUrl.includes('YOUR_')) {
        console.warn('Webhook not configured');
        return;
    }

    const payload = {
        score,
        recommendations,
        answers,
        timestamp: new Date().toISOString()
    };

    try {
        const response = await fetch(CONFIG.makeWebhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            console.error(`Webhook failed: ${response.status}`);
        } else {
            console.log('Webhook sent successfully');
        }
    } catch (error) {
        console.error('Webhook error:', error);
    }
}

// ===== NAVIGATION =====
function nextQuestion() {
    const input = document.querySelector(`.question[data-question="${currentQuestion}"] input, .question[data-question="${currentQuestion}"] select`);
    
    if (input && !input.value) {
        input.style.border = '2px solid #e74c3c';
        setTimeout(() => input.style.border = '', 2000);
        return;
    }

    const question = document.querySelector(`.question[data-question="${currentQuestion}"]`);
    const selected = question.querySelector('.option.selected');
    
    if (!selected && !input) {
        alert('Veuillez sélectionner une option');
        return;
    }

    if (currentQuestion === 1 && answers.company_name) {
        sendEarlyLead();
    }

    if (currentQuestion === 7 && answers.email) {
        sendEmailLead();
    }

    if (currentQuestion < totalQuestions) {
        currentQuestion++;
        showQuestion(currentQuestion);
        updateProgress();
    } else {
        showResults();
    }
}

function prevQuestion() {
    if (currentQuestion > 1) {
        currentQuestion--;
        showQuestion(currentQuestion);
        updateProgress();
    }
}

function showQuestion(num) {
    document.querySelectorAll('.question').forEach(q => q.classList.remove('active'));
    document.querySelector(`.question[data-question="${num}"]`).classList.add('active');
    
    document.getElementById('btnPrev').style.display = num === 1 ? 'none' : 'inline-flex';
    document.getElementById('btnNext').textContent = num === totalQuestions ? 'Voir mes résultats' : 'Suivant';

    setTimeout(() => {
        const input = document.querySelector(`.question[data-question="${num}"] input`);
        if (input) input.focus();
    }, 100);
}

function updateProgress() {
    const percent = ((currentQuestion - 1) / totalQuestions) * 100;
    document.getElementById('progressBar').style.width = `${percent}%`;
    document.getElementById('progressText').textContent = `Question ${currentQuestion} / ${totalQuestions}`;
}

function selectOption(button, questionId, value) {
    button.parentElement.querySelectorAll('.option').forEach(opt => opt.classList.remove('selected'));
    button.classList.add('selected');
    answers[questionId] = value;
}

// ===== CALCUL SCORE & RECOMMANDATIONS ENRICHIES =====
function calculateScore() {
    let score = 100;
    const recommendations = [];

    // Puissance souscrite (Q4)
    if (answers.power_fit === 'non') {
        score -= 15;
        recommendations.push({
            title: "🔴 Puissance mal adaptée — surcoût probable",
            text: "Une puissance souscrite trop élevée génère des frais fixes inutiles (terme puissance, tarif TURPE). Trop basse, elle expose à des dépassements tarifés. Un audit de puissance prend moins d'une heure.",
            saving: estimateSaving(5, 15)
        });
    } else if (answers.power_fit === 'ne_sais_pas') {
        score -= 8;
        recommendations.push({
            title: "🟠 Puissance souscrite — à vérifier",
            text: "La puissance souscrite est souvent définie à l'ouverture du contrat et jamais réévaluée, même lorsque les usages évoluent. Notre intervention repose sur une analyse rigoureuse : en interrogeant directement ENEDIS, nous consultons l'historique de consommation des 24 à 36 derniers mois pour comparer la puissance réellement appelée à la puissance souscrite. Cette lecture précise permet de détecter un surdimensionnement éventuel et d'engager les ajustements qui s'imposent.",
            saving: null
        });
    }

    // Dernière renégociation (Q8)
    if (answers.last_renewal === 'jamais') {
        score -= 25;
        recommendations.push({
            title: "🔴 Contrat jamais renégocié — risque maximal",
            text: "Un contrat établi sans négociation active n'est, par définition, jamais calibré aux conditions réelles du marché. Il ne bénéficie d'aucune des optimisations accessibles à ceux qui pilotent leur achat avec méthode. Les fournisseurs n'ajustent pas spontanément leurs tarifs à la baisse. Se faire accompagner par un expert garantit de profiter de conditions avantageuses et de conseils avisés pour prendre la bonne décision.",
            saving: estimateSaving(15, 25)
        });
    }
    if (answers.last_renewal === '>2ans') {
        score -= 20;
        recommendations.push({
            title: "🟠 Renégociation en retard (+2 ans)",
            text: "Les prix de l'énergie ont connu des variations considérables sur les cinq dernières années. Selon la date et les conditions de signature de votre contrat actuel, vous vous trouvez peut-être dans une fenêtre de tir intéressante pour profiter des niveaux de marché actuels. C'est précisément ce que nous évaluons pour vous.",
            saving: estimateSaving(10, 20)
        });
    }
    if (answers.last_renewal === '1-2ans') {
        score -= 10;
        recommendations.push({
            title: "🟡 Contrat à surveiller (1-2 ans)",
            text: "Votre contrat approche de la fenêtre idéale pour agir. Contrairement aux idées reçues, il n'est pas nécessaire d'attendre l'échéance : les marchés de l'énergie offrent la possibilité de sécuriser ses achats jusqu'à 36 mois à l'avance, permettant ainsi de lisser les pics de volatilité et de maîtriser son budget sur le long terme.",
            saving: null
        });
    }
    if (answers.last_renewal === 'ne_sais_pas') {
        score -= 12;
        recommendations.push({
            title: "🟠 Date de renégociation inconnue — risque de hors-marché",
            text: "Ne pas connaître la date de votre dernière renégociation est souvent le signe que la gestion énergétique n'est pas formalisée. Retrouvez cette date sur votre contrat ou facture — elle conditionne toute votre stratégie d'achat.",
            saving: null
        });
    }

    // Prix actuel (Q9)
    if (answers.current_price === 'non') {
        score -= 20;
        recommendations.push({
            title: "🔴 Prix inconnu — angle mort critique",
            text: "Ne pas connaître son prix unitaire d'énergie est le premier obstacle à toute démarche d'optimisation. Ce chiffre figure sur vos factures, généralement dans la ligne dédiée à la fourniture d'énergie — mais le repérer n'est pas toujours aisé. Chaque fournisseur adopte sa propre présentation : certains intègrent des taxes dans le prix affiché, d'autres changent l'unité de mesure, expriment le prix en centimes d'euro par kWh ou en €/kWh plutôt qu'en €/MWh. Cette opacité est rarement fortuite. Nous savons lire ces factures, et nous le faisons pour vous.",
            saving: null
        });
    }
    if (answers.current_price === 'oui_cher') {
        score -= 15;
        recommendations.push({
            title: "🟠 Prix jugé élevé — action possible",
            text: "Votre perception est souvent juste. Une consultation de marché permettra de quantifier précisément l'écart avec les offres compétitives actuelles et d'obtenir des alternatives concrètes.",
            saving: estimateSaving(10, 20)
        });
    }

    // Accise (Q10) — logique NAF
    const eligibility = answers.accise_eligibility || 'unknown';
    const nafCode     = answers.naf_code    || null;
    const nafLabel    = answers.naf_libelle || null;
    const nafDisplay  = nafCode ? ` (code NAF ${nafCode}${nafLabel ? ' — ' + nafLabel : ''})` : '';
    if (answers.tax_exemptions === 'non') {
        score -= 20;
        if (eligibility === 'super_reduit') {
            recommendations.push({ title: "🔴 Accise — taux super-réduit probablement applicable", text: `Votre secteur d'activité${nafDisplay} est éligible à un taux d'accise sur l'énergie significativement réduit, réservé aux activités agricoles, sylvicoles et aquacoles. Si ce taux n'est pas appliqué sur vos factures actuelles, vous payez trop depuis le premier jour. Une étude approfondie de votre dossier — incluant bilans comptables et analyse des usages — est nécessaire pour en établir l'éligibilité formelle, initier la régularisation et récupérer d'éventuels trop-perçus sur les exercices passés.`, saving: estimateSaving(8, 15) });
        } else if (eligibility === 'reduit') {
            recommendations.push({ title: "🔴 Accise — taux réduit industriel probablement applicable", text: `Votre secteur d'activité${nafDisplay} entre dans le périmètre des activités industrielles et extractives pour lesquelles la réglementation prévoit un taux d'accise réduit sur l'énergie. Si ce régime n'est pas activé sur vos contrats actuels, vous supportez un surcoût fiscal injustifié. Déterminer précisément votre éligibilité requiert une étude sérieuse de votre dossier : bilan comptable, nature et intensité des process consommateurs, volumes par site. Nous conduisons cette analyse dans les règles de l'art et accompagnons, le cas échéant, la constitution du dossier de remboursement.`, saving: estimateSaving(8, 15) });
        } else if (eligibility === 'potentiel') {
            recommendations.push({ title: "🟠 Accise — éligibilité à expertiser", text: `Votre secteur d'activité${nafDisplay} peut, selon l'intensité réelle de vos consommations et la nature de vos process, ouvrir droit à un régime d'accise allégé. Ce point mérite une analyse rigoureuse : l'éligibilité dépend de critères précis — part de l'énergie dans la valeur ajoutée, nature des installations — qui ne peuvent être établis sans étude de dossier. Nous conduisons cette analyse et accompagnons, le cas échéant, la constitution de la demande de remboursement.`, saving: estimateSaving(5, 12) });
        } else {
            recommendations.push({ title: "🔴 Accise sur l'énergie non optimisée — économies possibles", text: "L'accise sur l'énergie (anciennement TICFE pour l'électricité, TICGN pour le gaz) est l'un des principaux leviers fiscaux accessibles aux entreprises. Son taux peut varier significativement selon votre secteur d'activité et votre niveau de consommation. En déterminer l'éligibilité nécessite une étude sérieuse de votre dossier : bilan comptable, nature des activités, volumes consommés. Nous conduisons cette analyse dans les règles de l'art, et accompagnons le cas échéant la constitution du dossier de remboursement.", saving: estimateSaving(8, 15) });
        }
    } else if (answers.tax_exemptions === 'ne_sais_pas') {
        score -= 15;
        if (eligibility === 'super_reduit' || eligibility === 'reduit') {
            recommendations.push({ title: "🟠 Accise — votre secteur est probablement éligible à un taux réduit", text: `Bonne nouvelle : votre secteur d'activité${nafDisplay} figure parmi ceux pour lesquels la réglementation prévoit un taux d'accise sur l'énergie réduit. Ce régime, souvent ignoré, peut représenter une économie réelle sur vos factures. Encore faut-il que votre dossier soit constitué et déposé dans les formes : bilan comptable, justification des activités, volumes par site. C'est un vrai travail d'expert — et nous le menons à votre place.`, saving: null });
        } else {
            recommendations.push({ title: "🟠 Accise sur l'énergie — statut à clarifier", text: "L'accise sur l'énergie reste méconnue, alors qu'elle peut représenter une part significative de votre facture. Selon votre secteur d'activité et votre niveau de consommation, vous pourriez bénéficier d'un taux réduit ou d'une exonération — deux régimes distincts, aux conditions et aux impacts différents. En déterminer l'éligibilité nécessite une étude sérieuse de votre dossier : bilan comptable, nature des activités, volumes consommés. Nous conduisons cette analyse dans les règles de l'art, et accompagnons le cas échéant la constitution du dossier de remboursement.", saving: null });
        }
    }

    // Veille tarifaire (Q11)
    if (answers.monitoring === 'non_pas_temps') {
        score -= 15;
        recommendations.push({
            title: "🟠 Pas de veille tarifaire — opportunités manquées",
            text: "Les fenêtres d'achat favorables sur le marché de l'énergie peuvent se refermer en moins de 48 heures. Sans une présence continue sur le marché, on signe souvent au mauvais moment — sans même le savoir. Nos experts sont connectés aux marchés à longueur de journée. C'est cette vigilance permanente qui permet de saisir les opportunités au bon moment, et non de les constater après coup.",
            saving: null
        });
    }
    if (answers.monitoring === 'moi_meme') {
        score -= 8;
        recommendations.push({
            title: "🟡 Veille en solo — risque de manquer les fenêtres",
            text: "Assurer soi-même une veille efficace sur les marchés de l'énergie demande bien plus qu'une consultation quotidienne des prix. La plupart des acteurs qui s'y risquent regardent les mauvais indicateurs : ils suivent les prix immédiats alors que les décisions d'achat se prennent sur les marchés à terme, ils s'intéressent aux mauvaises années calendaires, et interprètent des signaux qui ne reflètent pas leur situation réelle. La gestion active d'un portefeuille d'énergie est un métier — et le confier à un expert, c'est précisément éviter ces erreurs de lecture.",
            saving: null
        });
    }
    if (answers.monitoring === 'non_externalise') {
        score -= 5;
        recommendations.push({
            title: "🟢 Bonne intuition sur l'externalisation",
            text: "Externaliser la veille énergétique est la décision la plus rentable pour la plupart des PME. Un expert en achat d'énergie actif surveille les indices (PEG, EEX, Epex Spot) en temps réel et vous alerte au moment optimal.",
            saving: null
        });
    }

    // Mode de fixation du prix (Q6)
    if (answers.contract_type === 'ne_sais_pas') {
        score -= 10;
        recommendations.push({
            title: "🟠 Mode de fixation inconnu — choisir la bonne formule peut changer la donne",
            text: "Chaque mécanisme répond à une logique différente : le prix fixe apporte de la visibilité budgétaire ; le prix indexé suit le marché et peut être avantageux en période de baisse ; le bloc + spot combine sécurité et flexibilité ; le cliquage permet d'acheter par tranches au moment le plus opportun. Le bon choix dépend de vos habitudes de consommation et de votre appétence au risque — c'est précisément ce sur quoi nous pouvons vous aider à trancher ensemble.",
            saving: null
        });
    }
    if (answers.contract_type === 'fixe' && (answers.last_renewal === '>2ans' || answers.last_renewal === 'jamais')) {
        recommendations.push({
            title: "💡 Contrat fixe signé en période de prix hauts",
            text: "Le marché de l'énergie a profondément évolué ces dernières années, et dans la grande majorité des situations que nous analysons, nos acheteurs identifient des opportunités significativement plus favorables que les conditions actuellement en cours. Ce qui change tout : ces prix peuvent être sécurisés dès aujourd'hui, pour prendre effet à l'échéance de votre contrat en cours. N'attendez pas la fin de votre contrat pour agir. Le bon moment pour préparer la suite, c'est maintenant, pendant que le marché vous y invite.",
            saving: null
        });
    }

    // Consommation (Q3)
    if (answers.consumption === 'ne_sais_pas') {
        score -= 8;
        recommendations.push({
            title: "🟠 Consommation inconnue — point de départ essentiel",
            text: "La consommation annuelle est le point de départ de toute stratégie d'achat d'énergie. Le détail mensuel figure sur vos factures — mais notre lien privilégié avec ENEDIS nous permet d'aller bien plus loin : nous accédons directement à vos données de consommation et pouvons en reconstituer le profil avec une granularité jusqu'à la minute, pour bâtir une stratégie d'achat réellement adaptée à vos usages.",
            saving: null
        });
    }
    if ((answers.consumption === '>5000' || answers.consumption === '1000-5000') && score < 75) {
        recommendations.push({
            title: "📊 Volume élevé : priorité absolue à l'optimisation",
            text: "Au-delà de 1 000 MWh/an, chaque euro de réduction sur votre €/MWh se traduit par des milliers d'euros d'économies annuelles. Une négociation structurée avec plusieurs fournisseurs est indispensable.",
            saving: estimateSaving(20, 40)
        });
    }

    // Score haut
    if (score >= 85) {
        recommendations.push({
            title: "✅ Bonne maîtrise de votre stratégie énergétique",
            text: "Vos pratiques d'achat énergétique sont solides. Un audit de confirmation permettrait néanmoins d'identifier les 5 à 10% d'optimisation résiduelle accessibles.",
            saving: null
        });
    }

    // Ne sais pas multiple
    if (Object.values(answers).filter(v => v === 'ne_sais_pas').length >= 3) {
        recommendations.unshift({
            title: "ℹ️ Pas d'inquiétude, vous êtes en bonne compagnie",
            text: "La plupart des dirigeants et responsables que nous accompagnons n'ont pas de réponse immédiate à ces questions — et c'est tout à fait normal. La gestion de l'énergie est un métier à part entière, avec ses propres marchés, sa fiscalité, ses mécanismes de prix. Ce n'est pas votre cœur de métier, et ce n'est pas censé l'être.\n\nC'est pourquoi nous prenons ce sujet en main à votre place. En pratique, nos clients consacrent en moyenne 6 minutes à nous transmettre leurs documents, 12 minutes à échanger avec leur acheteur dédié, et une quinzaine de minutes à relire avec nous puis signer un contrat qui sécurise leur énergie pour les années à venir. Ensuite, nous restons présents : un point de suivi tous les six mois pour s'assurer que votre stratégie reste alignée avec les évolutions du marché. Tout cela, sans jargon et sans frais. Nous sommes rémunérés par le fournisseur à hauteur du volume d'affaires que nous lui apportons.",
            saving: null
        });
    }

    return { score: Math.max(score, 0), recommendations };
}

function estimateSaving(minPercent, maxPercent) {
    const consumption = answers.consumption;
    if (!consumption || consumption === 'ne_sais_pas') return null;

    const ranges = {
        '<100': 50,
        '100-500': 300,
        '500-1000': 750,
        '1000-5000': 3000,
        '>5000': 10000
    };

    const avgMWh = ranges[consumption] || 300;
    const avgPrice = answers.energy_type === 'gaz' ? 50 : 100;
    const annualCost = avgMWh * avgPrice;
    const savingMin = Math.round(annualCost * minPercent / 100);
    const savingMax = Math.round(annualCost * maxPercent / 100);

    return savingMin === savingMax 
        ? `${savingMin.toLocaleString('fr-FR')} €/an`
        : `${savingMin.toLocaleString('fr-FR')} - ${savingMax.toLocaleString('fr-FR')} €/an`;
}

// ===== RÉSULTATS =====
function showResults() {
    document.getElementById('questionsContainer').style.display = 'none';
    document.getElementById('loadingContainer').style.display = 'flex';

    setTimeout(() => {
        const { score, recommendations } = calculateScore();
        
        document.getElementById('loadingContainer').style.display = 'none';
        document.getElementById('resultsContainer').style.display = 'block';

        document.getElementById('scoreValue').textContent = score;
        document.getElementById('scoreBar').style.width = `${score}%`;

        const scoreBar = document.getElementById('scoreBar');
        scoreBar.className = 'score-bar';
        if (score >= 80) scoreBar.classList.add('high');
        else if (score >= 60) scoreBar.classList.add('medium');
        else scoreBar.classList.add('low');

        const recosHTML = recommendations.map(r => `
            <div class="recommendation">
                <h4>${r.title}</h4>
                <p>${r.text}</p>
                ${r.saving ? `<div class="saving">💰 Économies estimées : <strong>${r.saving}</strong></div>` : ''}
            </div>
        `).join('');

        document.getElementById('recommendations').innerHTML = recosHTML;

        sendFinalWebhook(score, recommendations);
    }, 2000);
}

// ===== INIT =====
document.addEventListener('DOMContentLoaded', () => {
    showQuestion(1);
    updateProgress();
});
