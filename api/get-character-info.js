const https = require("https"); // ✨ [오류 수정] 따옴표 오타를 수정했습니다.

// 넥슨 서버에 안전하게 데이터를 요청하는 함수
function nexonApiRequest(path, apiKey) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: "open.api.nexon.com",
      path: path,
      method: "GET",
      headers: { "x-nxopen-api-key": apiKey },
    };
    const req = https.request(options, (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        // API 서버가 에러 코드를 보냈을 때
        return reject(
          new Error(`Nexon API Error: Status Code ${res.statusCode}`)
        );
      }
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          // 응답이 JSON 형식이 아닐 때
          reject(new Error("Failed to parse Nexon API response."));
        }
      });
    });
    req.on("error", (e) =>
      reject(new Error(`Network request failed: ${e.message}`))
    );
    req.end();
  });
}

// 우리의 '비서' 프로그램 메인 로직
export default async function handler(request, response) {
  try {
    const characterName = request.query.characterName;
    if (!characterName) {
      return response.status(400).json({ error: "캐릭터 이름이 필요합니다." });
    }

    const apiKey = process.env.NEXON_API_KEY;
    if (!apiKey) {
      throw new Error("API 키가 서버에 설정되지 않았습니다.");
    }

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dateString = yesterday.toISOString().split("T")[0];

    // 1. OCID 조회
    const ocidData = await nexonApiRequest(
      `/maplestory/v1/id?character_name=${encodeURIComponent(characterName)}`,
      apiKey
    );
    const ocid = ocidData.ocid;
    if (!ocid) {
      return response.status(404).json({ error: "캐릭터를 찾을 수 없습니다." });
    }

    // 2. 프리셋별 능력치 정보를 동시에 요청
    const presetStatPromises = [
      nexonApiRequest(
        `/maplestory/v1/character/stat?ocid=${ocid}&date=${dateString}&preset_no=1`,
        apiKey
      ),
      nexonApiRequest(
        `/maplestory/v1/character/stat?ocid=${ocid}&date=${dateString}&preset_no=2`,
        apiKey
      ),
      nexonApiRequest(
        `/maplestory/v1/character/stat?ocid=${ocid}&date=${dateString}&preset_no=3`,
        apiKey
      ),
    ];

    // 현재 착용 장비 정보와 기본 정보도 함께 요청
    const itemDataPromise = nexonApiRequest(
      `/maplestory/v1/character/item-equipment?ocid=${ocid}&date=${dateString}`,
      apiKey
    );
    const basicDataPromise = nexonApiRequest(
      `/maplestory/v1/character/basic?ocid=${ocid}&date=${dateString}`,
      apiKey
    );

    // 3. 모든 프리셋의 스탯 정보와 기타 정보를 한꺼번에 받음
    const [preset1Stat, preset2Stat, preset3Stat, itemData, basicData] =
      await Promise.all([
        ...presetStatPromises,
        itemDataPromise,
        basicDataPromise,
      ]);

    // 4. 각 프리셋의 전투력을 찾아 배열에 담기
    const combatPowers = [preset1Stat, preset2Stat, preset3Stat].map(
      (statData) => {
        if (statData && statData.final_stat) {
          const powerStat = statData.final_stat.find(
            (s) => s.stat_name === "전투력"
          );
          return powerStat ? parseInt(powerStat.stat_value) : 0;
        }
        return 0;
      }
    );

    // 5. 가장 높은 전투력을 '최고 전투력'으로 확정
    const maxCombatPower = Math.max(...combatPowers);

    // 현재 장착 프리셋의 능력치 정보 (메인 페이지 보여주기용)
    const currentStatData = preset1Stat; // 1번 프리셋을 현재 스탯으로 간주

    // 6. 최종적으로 모든 정보를 합쳐서 클라이언트에게 전달
    response.status(200).json({
      basicData,
      statData: { ...currentStatData, max_combat_power: maxCombatPower }, // 현재 스탯 정보에 최고 전투력 값을 추가해서 전달
      itemData,
    });
  } catch (error) {
    console.error("서버리스 함수에서 심각한 오류 발생:", error);
    response.status(500).json({
      error: "서버에서 요청을 처리하는 중 오류가 발생했습니다.",
      details: error.message,
    });
  }
}
