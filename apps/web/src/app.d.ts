import type { UserProfile } from '$lib/api';

declare global {
	namespace App {
		// interface Error {}
		interface Locals {
			user: UserProfile | null;
		}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
