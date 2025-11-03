// ... (dosyanın geri kalanını aynen koruyun)

// Prompt inşası (GENEL VE KONU-BAĞIMSIZ ŞABLONLA GÜÇLENDİRİLDİ)
function buildRoundPrompt(basePrompt, round, allRoundResponses, currentModel = null, isSerious = false) {
  // Genel talimatlar (her konuya uygun, kısa ve pratik vurgulu)
  const r1Style =
    "Provide a short and concise answer that directly addresses the user's question. Avoid filler and hedging. If there are important caveats or risks, mention them briefly.";
  const r2Style =
    "Refine your answer by incorporating new, practical value (e.g., clear steps, trade-offs, cost/time/complexity hints). State the strength of evidence in one short phrase (e.g., early, moderate, strong) without fabricating citations. Keep it focused and concrete.";
  const r3Style =
    "Deliver a concise, high-utility synthesis: correct any inaccuracies politely, clarify uncertainties, and provide up to 4 actionable suggestions. Emphasize clarity, evidence strength (early/moderate/strong), and practical trade-offs.";

  const roundInstruction = round === 1 ? r1Style : round === 2 ? r2Style : r3Style;

  // Ciddiyet tonu (sağlık/hukuk/finans vb.)
  const seriousnessTone = isSerious
    ? "Use a professional and cautious tone. Do not include humor or playful remarks. If the topic can affect health, legal status, or finances, remind the user to consult a qualified professional."
    : "Maintain a clear and respectful tone. Avoid unnecessary jokes; prioritize clarity.";

  // Nihai sistem talimatı
  let prompt = [
    basePrompt,
    "",
    `[ROUND ${round} INSTRUCTION]: ${roundInstruction}`,
    seriousnessTone,
  ].join("\n");

  // Önceki turlara atıf (kendi önceki cevabını görmezden gel, diğerlerini değerlendir)
  if (round > 1) {
    const prev = allRoundResponses
      .filter((r) => r.round < round && r.model !== currentModel)
      .map((r) => `- [${r.model} R${r.round}] ${r.text}`)
      .join("\n");

    prompt += [
      "",
      "Other models' previous points to consider (do not repeat them verbatim; refine or challenge constructively):",
      prev || "(no responses captured)",
      "Briefly note agreements/disagreements and improve your answer accordingly.",
    ].join("\n");
  }

  return prompt;
}

// Moderatör prompt (KONU-BAĞIMSIZ, KARAR ODAKLI VE PRATİK ŞABLON)
function moderatorPrompt(language, collected, rounds = 1, isSerious = false) {
  const considerRounds =
    rounds <= 1 ? [1] :
    rounds === 2 ? [1, 2] :
    [1, 2, 3];

  const filtered = collected.filter(c => considerRounds.includes(c.round));
  const lines = filtered.map((c) => `- [${c.model} R${c.round}] ${c.text}`).join('\n');

  const scopeText =
    considerRounds.length === 1 ? "Round 1 only" :
    considerRounds.length === 2 ? "Rounds 1 and 2" :
    "Rounds 1, 2 and 3";

  const lengthDiscipline =
    considerRounds.length === 1
      ? "Be very concise. Keep each section to 1–2 sentences or up to 3 bullets."
      : "Be concise. Keep each section short; prioritize clarity and utility.";

  const tone = isSerious
    ? "Use a professional, cautious tone. Avoid humor. If the topic can affect health, legal status, or finances, include a clear disclaimer and advise consulting a qualified professional."
    : "Use a clear, neutral, and helpful tone. Avoid unnecessary flourish; focus on clarity and actionability.";

  // Konu bağımsız, sağlam şablon
  const basePrompt = [
    `Act as a neutral, rigorous moderator who synthesizes multiple AI responses into a single, useful answer.`,
    `Scope: ${scopeText}.`,
    `${tone}`,
    `${lengthDiscipline}`,
    ``,
    `Your output MUST follow this structure (use these exact headings in ${language}):`,
    `## Kısa Özet`,
    `- 2–3 cümlede sorunun çekirdeğini, ana uzlaşı/ayrışma noktalarını ve kanıt gücünü (ör. erken/orta/güçlü) belirt.`,
    ``,
    `## Modellerin Değerlendirmesi`,
    `- Her model için 1–2 cümle: güçlü yan (somut katkı) ve zayıf yan (eksik/abartı/konu dışı).`,
    ``,
    `## Karşılaştırma ve Kanıt Çerçevesi`,
    `- Nerede hemfikirler, nerede ayrışıyorlar.`,
    `- Kanıt türü düzeyinde konuş (ör. resmi yönergeler, meta-analiz, uzman görüşü, endüstri standardı). Spesifik kaynak uydurma.`,
    ``,
    `## Karar ve Gerekçe`,
    `- 1 cümlede net karar ver.`,
    `- En fazla 2 maddeyle gerekçeyi özetle (kanıt gücü veya rasyonel dayanak).`,
    ``,
    `## Pratik Plan`,
    `- 3–5 kısa, uygulanabilir adım sun. Karar/tercih sorularında basit bir karar matrisi yaklaşımı kullan (ör. "bütçe duyarlıysanız A, en yüksek etki istiyorsanız B").`,
    ``,
    `## Riskler ve Uyarılar`,
    `- Konuya özgü riskler/etik/uyumluluk notları; belirsizlik nerede, hangi varsayımlar yapıldı.`,
    `${isSerious ? "- Sağlık/hukuk/finans etkisi olabilecek konularda net uyarı ve uzman danışma önerisi ekle." : ""}`,
    ``,
    `## Sonuç`,
    `- Tek cümlede net, rehber tonda bir sonuç cümlesi yaz.`,
    ``,
    `Respond strictly in ${language}. Do not switch languages.`,
    ``,
    `Model responses to consider (${scopeText}):`,
    lines || "(no responses captured)"
  ].filter(Boolean).join('\n');

  return basePrompt;
}

// ... (dosyanın geri kalanını aynen koruyun)
