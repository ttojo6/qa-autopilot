/**
 * Queryable — DB 접근의 최소 포트. pg.Pool도 이 형태를 만족한다.
 * 이 포트 뒤에 어댑터를 두어 실제 DB 없이도 SQL·매핑을 테스트할 수 있다.
 */
export interface Queryable {
  query<R = Record<string, unknown>>(
    text: string,
    params?: readonly unknown[]
  ): Promise<{ rows: R[] }>;
}
