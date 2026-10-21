<script lang="ts">
	import './layout.css';
	import type { LayoutProps } from './$types';
	import { page } from '$app/state';
	import { api } from '$lib/api';
	import { goto } from '$app/navigation';
	import {
		LayoutDashboard,
		Briefcase,
		MessageSquare,
		FileEdit,
		Users,
		Zap,
		Plug,
		ShieldCheck,
		LogOut,
		Bot
	} from 'lucide-svelte';

	let { data, children }: LayoutProps = $props();

	let isLoggingOut = $state(false);

	async function handleLogout() {
		isLoggingOut = true;
		try {
			await api.logout();
			await goto('/login');
		} catch {
			window.location.href = '/login';
		} finally {
			isLoggingOut = false;
		}
	}

	const isLoginPage = $derived(page.url.pathname === '/login');

	const navItems = [
		{
			href: '/dashboard',
			label: 'Dashboard',
			icon: LayoutDashboard,
			badge: null,
			badgeClass: ''
		},
		{
			href: '/commissions',
			label: 'Commissions',
			icon: Briefcase,
			badge: '5',
			badgeClass: 'bg-[#fff3e0] text-[#ff9600] border border-[#ffe0b2]'
		},
		{
			href: '/conversations',
			label: 'Conversations',
			icon: MessageSquare,
			badge: '2',
			badgeClass: 'bg-[#ddf4ff] text-[#1cb0f6] border border-[#c7e8fa]'
		},
		{
			href: '/drafts',
			label: 'Drafts & Approvals',
			icon: FileEdit,
			badge: '3',
			badgeClass: 'bg-[#f3e5f5] text-[#af71f5] border border-[#e1bee7]'
		},
		{
			href: '/clients',
			label: 'Clients',
			icon: Users,
			badge: null,
			badgeClass: ''
		},
		{
			href: '/agent',
			label: 'Agent Tasks',
			icon: Zap,
			badge: '1 active',
			badgeClass: 'bg-[#e8f5e9] text-[#2e7d32] border border-[#c8e6c9]'
		},
		{
			href: '/integrations',
			label: 'Integrations',
			icon: Plug,
			badge: null,
			badgeClass: ''
		},
		{
			href: '/audit-log',
			label: 'Audit Log',
			icon: ShieldCheck,
			badge: null,
			badgeClass: ''
		}
	];

	function isItemActive(href: string): boolean {
		if (href === '/dashboard') {
			return page.url.pathname === '/dashboard';
		}
		return page.url.pathname.startsWith(href);
	}
</script>

<svelte:head>
	<title>ClientAgent — VGen Creator Studio</title>
</svelte:head>

{#if isLoginPage}
	<main class="min-h-screen bg-[#ddf4ff] flex items-center justify-center p-4">
		{@render children()}
	</main>
{:else}
	<div class="min-h-screen bg-[#ddf4ff] flex font-sans text-[#3c3c3c]">
		<!-- Fixed 250px Sidebar -->
		<aside
			class="w-[250px] shrink-0 h-screen fixed left-0 top-0 bg-white border-r-2 border-[#c7e8fa] flex flex-col justify-between p-3.5 z-40 overflow-y-auto"
		>
			<!-- Top Section: Brand + Navigation -->
			<div class="space-y-4">
				<!-- Brand Container -->
				<div class="flex items-center gap-3 px-2 py-2.5 border-b-2 border-[#c7e8fa]/60">
					<div
						class="w-10 h-10 rounded-xl bg-[#a5ed6e] border-2 border-[#85ca54] flex items-center justify-center text-[#111111] shadow-xs shrink-0"
					>
						<Bot class="w-5 h-5 text-[#111111]" strokeWidth={2.5} />
					</div>
					<div class="min-w-0 flex-1">
						<a
							href="/dashboard"
							class="block font-bold text-base text-[#3c3c3c] tracking-tight hover:text-[#1cb0f6] transition-colors leading-tight"
						>
							ClientAgent
						</a>
						<span class="block text-xs font-semibold text-[#1cb0f6] tracking-wide leading-tight mt-0.5">
							VGen Creator Studio
						</span>
					</div>
				</div>

				<!-- Navigation Items -->
				<nav class="space-y-1">
					{#each navItems as item}
						{@const active = isItemActive(item.href)}
						<a
							href={item.href}
							class="group flex items-center justify-between px-3 py-2.5 rounded-xl text-sm font-semibold transition-colors {active
								? 'bg-[#ddf4ff] text-[#1cb0f6] border-2 border-[#c7e8fa]'
								: 'text-[#3c3c3c] hover:bg-[#f4faff] hover:text-[#1cb0f6] border-2 border-transparent'}"
						>
							<div class="flex items-center gap-2.5 min-w-0">
								<item.icon
									class="w-4 h-4 shrink-0 transition-colors {active
										? 'text-[#1cb0f6]'
										: 'text-[#777777] group-hover:text-[#1cb0f6]'}"
									strokeWidth={active ? 2.5 : 2}
								/>
								<span class="truncate">{item.label}</span>
							</div>

							{#if item.badge}
								<span
									class="text-[11px] font-bold px-2 py-0.5 rounded-xl shrink-0 {item.badgeClass}"
								>
									{item.badge}
								</span>
							{/if}
						</a>
					{/each}
				</nav>
			</div>

			<!-- Bottom Section: Live Status Card + Creator Profile -->
			<div class="space-y-3 pt-4 border-t-2 border-[#c7e8fa]/60">
				<!-- Live Integrations Status Card -->
				<div class="bg-[#f4faff] border-2 border-[#c7e8fa] rounded-xl p-3 space-y-2">
					<div class="text-[10px] font-bold uppercase tracking-wider text-[#777777] mb-1">
						Live Status
					</div>
					<div class="flex items-center justify-between text-xs">
						<span class="text-[#3c3c3c] font-semibold">VGen Session</span>
						<span class="inline-flex items-center gap-1.5 text-[#58cc02] font-bold text-[11px]">
							<span class="w-2 h-2 rounded-full bg-[#58cc02] animate-pulse"></span>
							Active
						</span>
					</div>
					<div class="flex items-center justify-between text-xs">
						<span class="text-[#3c3c3c] font-semibold">Gmail Pub/Sub</span>
						<span class="inline-flex items-center gap-1.5 text-[#58cc02] font-bold text-[11px]">
							<span class="w-2 h-2 rounded-full bg-[#58cc02]"></span>
							Listening
						</span>
					</div>
					<div class="flex items-center justify-between text-xs">
						<span class="text-[#3c3c3c] font-semibold">Discord Bot</span>
						<span class="inline-flex items-center gap-1.5 text-[#58cc02] font-bold text-[11px]">
							<span class="w-2 h-2 rounded-full bg-[#58cc02]"></span>
							Online
						</span>
					</div>
				</div>

				<!-- Creator Profile Card -->
				<div
					class="bg-white border-2 border-[#c7e8fa] rounded-xl p-2.5 flex items-center justify-between gap-2 shadow-xs"
				>
					<div class="flex items-center gap-2.5 min-w-0">
						<div
							class="w-9 h-9 rounded-xl bg-[#ddf4ff] border-2 border-[#c7e8fa] text-[#1cb0f6] font-bold flex items-center justify-center shrink-0 text-sm"
						>
							EO
						</div>
						<div class="min-w-0 truncate">
							<div class="text-xs font-bold text-[#3c3c3c] truncate leading-tight">
								{data?.user?.name || 'Erian Osamu'}
							</div>
							<div class="text-[11px] text-[#777777] font-medium truncate leading-tight">
								@{data?.user?.name ? data.user.name.toLowerCase().replace(/\s+/g, '') : 'erianosamu'}
							</div>
						</div>
					</div>

					<button
						type="button"
						onclick={handleLogout}
						disabled={isLoggingOut}
						title="Sign out"
						aria-label="Sign out"
						class="p-1.5 text-[#777777] hover:text-[#ff4b4b] hover:bg-[#ffe5e5] rounded-lg transition-colors cursor-pointer shrink-0"
					>
						<LogOut class="w-4 h-4" />
					</button>
				</div>
			</div>
		</aside>

		<!-- Main Content Area with 250px left margin -->
		<main class="flex-1 ml-[250px] min-h-screen p-6 lg:p-8">
			{@render children()}
		</main>
	</div>
{/if}
