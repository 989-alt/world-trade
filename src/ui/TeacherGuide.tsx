import './epilogue.css';

export const TEACHER_PRIVACY = '실명·학급은 저장되지 않습니다. 결과 파일 보관은 교사 책임입니다.';
export const CSV_COLUMNS = ['입항', '수출국', '물자·서비스', '수입국', '까닭'] as const;

export function TeacherGuide({ onClose }: { onClose: () => void }) {
  return (
    <div class="ep-root">
      <div class="ep-panel">
        <h2 class="ep-h">교사 안내</h2>
        <div class="ep-guide">
          <section><h3>조작</h3><p>방향키·WASD 또는 화면 D-패드로 배를 몰고, 항구 가까이에서 「입항」(Enter/탭)을 누릅니다. 입항은 6번입니다.</p></section>
          <section><h3>결과 파일</h3>
            <ul>
              <li>JSON: 닉네임·출석번호, 요약(코인·판정 정답 수·일지 행 수), 등급, 일지, 전체 로그</li>
              <li>CSV 열: {CSV_COLUMNS.join(', ')}</li>
            </ul>
          </section>
          <section><h3>평가 연결</h3><p>CSV 는 과정 중심 평가 문항 2 표로 씁니다. 수출국·물자·수입국 세 칸이 모두 채워진 행을 셉니다.</p></section>
          <section><h3>개인정보</h3><p>{TEACHER_PRIVACY}</p></section>
        </div>
        <button type="button" class="ep-btn cream" onClick={onClose}>닫기</button>
      </div>
    </div>
  );
}
