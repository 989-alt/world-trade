# K-무역상

초등학교 6학년 사회 6-2 「세계 속의 무역」 단원 정리용 항해 무역 게임. 부산항 견습 무역상이 되어 세계 지도를 항해하고, 거래마다 수입·수출 방향과 까닭(자연환경·자원·자본·기술·지리적 위치)을 판정한다. 한 판 약 30분.

- 백엔드 없음. 진행은 브라우저 `localStorage` 에만 저장되고, 학생 정보는 닉네임·출석번호만 쓴다.
- 결과는 JSON·CSV 파일로 내보내 교사가 수합한다.

## 실행

```bash
npm ci
npm run dev        # 개발 서버
npm run build      # dist/ 정적 빌드
npm test           # 단위 테스트
```

`dist/` 는 정적 서버(GitHub Pages 등)에서 연다. 이 저장소는 `gh-pages` 브랜치에 빌드 결과를 올려 배포한다. `index.html` 을 파일로 직접 열면 브라우저 보안 정책 때문에 동작하지 않는다.

## 라이선스

- 코드: MIT
- 글꼴: Jua, Noto Sans KR — SIL Open Font License 1.1 (`assets/fonts/LICENSE.txt`)
- 그림·음악: 생성 모델로 만든 이 게임 전용 에셋
