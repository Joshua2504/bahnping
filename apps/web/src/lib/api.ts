// Fetch-Wrapper für die API. Verträge siehe docs/API.md; Antworten werden mit den Zod-Schemas
// aus @bahn/shared geparst, Fehler kommen als RFC-9457-Problem-Details und werden als ApiError
// weitergeworfen.
import { z } from 'zod';
import {
	AdminAsn,
	AdminAsnUpdateResponse,
	CellsResponse,
	ConfirmRequest,
	Me,
	MeUpdate,
	MagicLinkRequest,
	Problem,
	PublicStats,
	Sample,
	SampleBatchResponse,
	Trip,
	TripEnd,
	TripSamples,
	WhoamiResponse,
	type AdminAsnUpdate,
	type CellsQuery,
	type TripCreate,
} from '@bahn/shared';

type MagicLinkRequestBody = z.infer<typeof MagicLinkRequest>;
type ConfirmRequestBody = z.infer<typeof ConfirmRequest>;
type MeUpdateBody = z.infer<typeof MeUpdate>;
type TripEndBody = z.infer<typeof TripEnd>;

/** Fehler aus der API, inkl. RFC-9457-Feldern. status 0 = Anfrage konnte nicht gesendet werden. */
export class ApiError extends Error {
	readonly status: number;
	readonly title: string;
	readonly detail?: string;
	readonly retryAfterSec?: number;

	constructor(status: number, title: string, detail?: string, retryAfterSec?: number) {
		super(detail ?? title);
		this.status = status;
		this.title = title;
		this.detail = detail;
		this.retryAfterSec = retryAfterSec;
	}
}

async function request<T>(path: string, init: RequestInit = {}, schema?: z.ZodType<T>): Promise<T> {
	let res: Response;
	try {
		res = await fetch(path, {
			credentials: 'same-origin',
			...init,
			headers: init.body ? { 'content-type': 'application/json', ...init.headers } : init.headers,
		});
	} catch {
		throw new ApiError(0, 'Netzwerkfehler', 'Die Anfrage konnte nicht gesendet werden.');
	}

	if (!res.ok) {
		let title = res.statusText || 'Fehler';
		let detail: string | undefined;
		const retryAfterHeader = res.headers.get('retry-after');
		const retryAfterSec = retryAfterHeader ? Number(retryAfterHeader) : undefined;

		if ((res.headers.get('content-type') ?? '').includes('json')) {
			try {
				const body = Problem.partial().parse(await res.json());
				title = body.title ?? title;
				detail = body.detail;
			} catch {
				// Kein gültiges Problem-Details-JSON, Standardtext verwenden.
			}
		}
		throw new ApiError(res.status, title, detail, retryAfterSec);
	}

	if (res.status === 204) return undefined as T;

	const data: unknown = await res.json();
	return schema ? schema.parse(data) : (data as T);
}

function withBody(method: string, body?: unknown): RequestInit {
	return { method, body: body === undefined ? undefined : JSON.stringify(body) };
}

export const api = {
	magicLink: (body: MagicLinkRequestBody) => request<void>('/api/auth/magic-link', withBody('POST', body)),
	confirm: (body: ConfirmRequestBody) => request('/api/auth/confirm', withBody('POST', body), Me),
	logout: () => request<void>('/api/auth/logout', withBody('POST')),
	logoutAll: () => request<void>('/api/auth/logout-all', withBody('POST')),

	me: () => request('/api/me', {}, Me),
	updateMe: (body: MeUpdateBody) => request('/api/me', withBody('PATCH', body), Me),
	deleteMe: () => request<void>('/api/me', withBody('DELETE')),
	exportUrl: () => '/api/me/export',

	createTrip: (body: TripCreate) => request('/api/trips', withBody('POST', body), Trip),
	listTrips: () => request('/api/trips', {}, z.array(Trip)),
	getTrip: (id: string) => request(`/api/trips/${id}`, {}, Trip),
	getTripSamples: (id: string) => request(`/api/trips/${id}/samples`, {}, TripSamples),
	endTrip: (id: string, body: TripEndBody) => request(`/api/trips/${id}/end`, withBody('POST', body), Trip),
	uploadSamples: (id: string, samples: Sample[]) =>
		request(`/api/trips/${id}/samples`, withBody('POST', { samples }), SampleBatchResponse),

	whoami: () => request('/api/net/whoami', {}, WhoamiResponse),
	speedStart: () => request<void>('/api/speed/start', withBody('POST')),

	publicCells: (query: CellsQuery) => {
		const params = new URLSearchParams({
			res: String(query.res),
			bbox: query.bbox,
			net: query.net,
			period: query.period,
			train: query.train,
		});
		if (query.mine) params.set('mine', 'true');
		return request(`/api/public/cells?${params.toString()}`, {}, CellsResponse);
	},
	publicStats: () => request('/api/public/stats', {}, PublicStats),
	publicLive: () => request('/api/public/live', {}, z.object({ activeTrips: z.number().int() })),

	adminAsns: (filter: 'unknown' | 'all') =>
		request(`/api/admin/asns?filter=${filter}`, {}, z.array(AdminAsn)),
	adminUpdateAsn: (asn: number, body: AdminAsnUpdate) =>
		request(`/api/admin/asns/${asn}`, withBody('PATCH', body), AdminAsnUpdateResponse),
};
