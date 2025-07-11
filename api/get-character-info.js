const https = require("https");

function nexonApiRequest(path, apiKey) {
  return new Promise((resolve) => {
    const options = {
      hostname: "open.api.nexon.com",
      path: path,
      method: "GET",
      headers: { "x-nxopen-api-key": apiKey },
    };
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve(null);
        }
      });
    });
    req.on("error", () => resolve(null));
    req.end();
  });
}

export default async function handler(request, response) {
  try {
    const characterName = request.query.characterName;
    if (!characterName)
      return response.status(400).json({ error: "캐릭터 이름이 필요합니다." });

    const apiKey = process.env.NEXON_API_KEY;
    if (!apiKey) throw new Error("API 키가 서버에 설정되지 않았습니다.");

    const ocidData = await nexonApiRequest(
      `/maplestory/v1/id?character_name=${encodeURIComponent(characterName)}`,
      apiKey
    );
    if (!ocidData || ocidData.error)
      return response
        .status(404)
        .json({ error: "캐릭터 OCID를 찾을 수 없습니다." });
    const ocid = ocidData.ocid;

    const results = await Promise.allSettled([
      nexonApiRequest(`/maplestory/v1/character/basic?ocid=${ocid}`, apiKey),
      nexonApiRequest(
        `/maplestory/v1/character/hyper-stat?ocid=${ocid}`,
        apiKey
      ),
      nexonApiRequest(`/maplestory/v1/character/ability?ocid=${ocid}`, apiKey),
      nexonApiRequest(
        `/maplestory/v1/character/stat?ocid=${ocid}&preset_no=1`,
        apiKey
      ),
      nexonApiRequest(
        `/maplestory/v1/item-equipment?ocid=${ocid}&preset_no=1`,
        apiKey
      ),
      nexonApiRequest(
        `/maplestory/v1/character/stat?ocid=${ocid}&preset_no=2`,
        apiKey
      ),
      nexonApiRequest(
        `/maplestory/v1/item-equipment?ocid=${ocid}&preset_no=2`,
        apiKey
      ),
      nexonApiRequest(
        `/maplestory/v1/character/stat?ocid=${ocid}&preset_no=3`,
        apiKey
      ),
      nexonApiRequest(
        `/maplestory/v1/item-equipment?ocid=${ocid}&preset_no=3`,
        apiKey
      ),
    ]);

    const getValue = (result) =>
      result.status === "fulfilled" ? result.value : null;

    const basicData = getValue(results[0]);
    const hyperStatData = getValue(results[1]);
    const abilityData = getValue(results[2]);
    const presetStats = [
      getValue(results[3]),
      getValue(results[5]),
      getValue(results[7]),
    ];
    const presetItems = [
      getValue(results[4]),
      getValue(results[6]),
      getValue(results[8]),
    ];

    if (!basicData)
      throw new Error("캐릭터의 필수 기본 정보를 불러오지 못했습니다.");

    const presetScores = [1, 2, 3].map((presetNo) => {
      const index = presetNo - 1;
      const stats = presetStats[index];
      const items = presetItems[index];
      let score = 0;

      const combatPowerStat = stats?.final_stat?.find(
        (s) => s.stat_name === "전투력"
      );
      const combatPower = combatPowerStat
        ? parseInt(combatPowerStat.stat_value, 10)
        : 0;

      // ✨ [핵심 수정] stats와 items, 그리고 그 안의 데이터가 모두 유효할 때만 점수를 계산합니다.
      if (stats && items && items.item_equipment) {
        // 어빌리티 점수
        abilityData?.ability_info?.forEach((ability) => {
          if (ability.ability_value.includes("보스 몬스터 공격 시 데미지"))
            score += 10;
          if (
            ability.ability_value.includes("아이템 드롭률") ||
            ability.ability_value.includes("메소 획득량")
          )
            score -= 10;
        });

        // 하이퍼스탯 점수
        const hyperStatPreset =
          hyperStatData?.[`hyper_stat_preset_${presetNo}`];
        if (hyperStatPreset) {
          const hyperStatIED = hyperStatPreset.find(
            (s) => s.stat_type === "방어율 무시"
          );
          if (hyperStatIED && parseInt(hyperStatIED.stat_level) > 0) score += 5;
        }

        // 아이템 점수
        const hasSeedRing = items.item_equipment.some(
          (item) =>
            item.item_name.includes("링") && !item.item_name.includes("어비스")
        );
        const hasDropPendant = items.item_equipment.some((item) =>
          item.item_name.includes("정령의 펜던트")
        );
        if (hasSeedRing) score += 5;
        if (hasDropPendant) score -= 5;
      }

      return { presetNo, score, combatPower };
    });

    presetScores.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.combatPower - a.combatPower;
    });

    const bestPreset = presetScores[0];
    const maxCombatPower = bestPreset.combatPower;

    const currentStatData = presetStats[0] || {};
    const allItems = new Map();
    presetItems.forEach((itemSet) => {
      itemSet?.item_equipment?.forEach((item) => {
        if (!allItems.has(item.item_name)) allItems.set(item.item_name, item);
      });
    });
    const combinedItemData = { item_equipment: Array.from(allItems.values()) };

    response.setHeader("Cache-Control", "s-maxage=1, stale-while-revalidate");
    response.status(200).json({
      basicData,
      statData: { ...currentStatData, max_combat_power: maxCombatPower },
      itemData: combinedItemData,
      data_date: basicData.date,
    });
  } catch (error) {
    console.error(
      `[${request.query.characterName}] 서버리스 함수 오류:`,
      error
    );
    response.status(500).json({
      error: "서버에서 요청을 처리하는 중 오류가 발생했습니다.",
      details: error.message,
    });
  }
}
