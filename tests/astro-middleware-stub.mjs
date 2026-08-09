/**
 * `astro:middleware` съществува само вътре в Astro. За тестовете е нужно само
 * да може да се импортира — проверяваме `classifyRoute`, не самия middleware.
 */
export function defineMiddleware(fn) {
  return fn;
}
