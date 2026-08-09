/**
 * Една грешка за всички доставчици на модели. Google и Cloudflare отговарят с
 * различни тела, но приложението нагоре по веригата се интересува само от три
 * неща: какъв е статусът, какво да покаже на човека, и дали проблемът е в ключа.
 */
export class AiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly detail?: unknown,
    /**
     * Проблем с достъпа, а не със самата заявка. Google връща част от тези с
     * 400, затова статусът не е достатъчен, за да се разпознаят.
     */
    readonly keyProblem = false,
  ) {
    super(message);
    this.name = 'AiError';
  }
}
