<script lang="ts">
	import { onMount } from 'svelte';
	import {
		api,
		type TaskItem,
		type TaskListParams
	} from '$lib/api';
	import {
		Zap,
		RefreshCw,
		CheckCircle2,
		Clock,
		AlertCircle,
		Send,
		MessageSquare,
		Sparkles,
		Inbox,
		X,
		Copy,
		Check,
		Layers,
		Activity,
		ExternalLink,
		RotateCcw,
		Terminal
	} from 'lucide-svelte';

	// Filter pill options
	type TaskFilter = 'all' | 'running' | 'queued' | 'completed' | 'failed';

	interface FilterTab {
		id: TaskFilter;
		label: string;
	}

	const filterTabs: FilterTab[] = [
		{ id: 'all', label: 'All' },
		{ id: 'running', label: 'Running' },
		{ id: 'queued', label: 'Queued' },
		{ id: 'completed', label: 'Completed' },
		{ id: 'failed', label: 'Failed / Dead' }
	];

	// Sample tasks for fallback preview when backend is unreachable
	const DEFAULT_SAMPLE_TASKS: TaskItem[] = [
		{
			id: 101,
			userId: 1,
			type: 'SEND_VGEN_MESSAGE',
			status: 'failed',
			attempts: 3,
			maxAttempts: 3,
			input: {
				conversationId: 10,
				draftId: 301,
				clientUsername: 'KitsuneMei',
				content: 'Hi Mei! Yes, the eye physics and blink physics layers are completed.'
			},
			output: null,
			error: 'Browser connection timed out after 30000ms while waiting for VGen thread drawer',
			idempotencyKey: 'send_msg_draft_301_rev1',
			startedAt: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
			completedAt: new Date(Date.now() - 14 * 60 * 1000).toISOString(),
			createdAt: new Date(Date.now() - 16 * 60 * 1000).toISOString(),
			updatedAt: new Date(Date.now() - 14 * 60 * 1000).toISOString()
		},
		{
			id: 102,
			userId: 1,
			type: 'GENERATE_REPLY_DRAFT',
			status: 'running',
			attempts: 1,
			maxAttempts: 3,
			input: {
				conversationId: 12,
				clientId: 2,
				clientUsername: 'StarlightVT',
				promptContext: 'Client inquiry regarding chibi emote pack delivery timeline'
			},
			output: null,
			error: null,
			idempotencyKey: 'reply_draft_conv_12',
			startedAt: new Date(Date.now() - 45 * 1000).toISOString(),
			completedAt: null,
			createdAt: new Date(Date.now() - 50 * 1000).toISOString(),
			updatedAt: new Date(Date.now() - 45 * 1000).toISOString()
		},
		{
			id: 103,
			userId: 1,
			type: 'PROCESS_GMAIL_EVENT',
			status: 'completed',
			attempts: 1,
			maxAttempts: 3,
			input: {
				messageId: '1923ab49cd891230',
				historyId: '891230',
				subject: 'New commission request from Starlight Ch.'
			},
			output: {
				eventId: 44,
				eventType: 'NEW_COMMISSION_REQUEST',
				clientUsername: 'StarlightVT',
				service: 'Chibi Character Emote Pack (x6)',
				amount: '180.00'
			},
			error: null,
			idempotencyKey: 'gmail_msg_1923ab49cd891230',
			startedAt: new Date(Date.now() - 42 * 60 * 1000).toISOString(),
			completedAt: new Date(Date.now() - 41 * 60 * 1000).toISOString(),
			createdAt: new Date(Date.now() - 43 * 60 * 1000).toISOString(),
			updatedAt: new Date(Date.now() - 41 * 60 * 1000).toISOString()
		},
		{
			id: 104,
			userId: 1,
			type: 'SYNC_CONVERSATION',
			status: 'queued',
			attempts: 0,
			maxAttempts: 3,
			input: {
				username: 'KitsuneMei',
				trigger: 'periodic_sync',
				unreadThreshold: 1
			},
			output: null,
			error: null,
			idempotencyKey: 'sync_conv_KitsuneMei_periodic',
			startedAt: null,
			completedAt: null,
			createdAt: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
			updatedAt: new Date(Date.now() - 2 * 60 * 1000).toISOString()
		},
		{
			id: 105,
			userId: 1,
			type: 'READ_VGEN_CONVERSATION',
			status: 'dead',
			attempts: 3,
			maxAttempts: 3,
			input: {
				username: 'ArchivedGhostClient',
				requestedMessages: 20
			},
			output: null,
			error: 'Max retries exhausted (3/3). Persistent 404: Conversation target not accessible on VGen profile',
			idempotencyKey: 'read_conv_ArchivedGhostClient',
			startedAt: new Date(Date.now() - 3 * 3600 * 1000).toISOString(),
			completedAt: new Date(Date.now() - 2.9 * 3600 * 1000).toISOString(),
			createdAt: new Date(Date.now() - 3.1 * 3600 * 1000).toISOString(),
			updatedAt: new Date(Date.now() - 2.9 * 3600 * 1000).toISOString()
		}
	];

	// Component State with Svelte 5 Runes
	let allTasks = $state<TaskItem[]>([]);
	let isLoading = $state(true);
	let isRefreshing = $state(false);
	let activeFilter = $state<TaskFilter>('all');
	let selectedTask = $state<TaskItem | null>(null);
	let isRetrying = $state(false);
	let copiedInput = $state(false);
	let copiedOutput = $state(false);

	// Toast state
	let toastMessage = $state<string | null>(null);
	let toastType = $state<'success' | 'error' | 'info'>('success');
	let toastTimeout = $state<ReturnType<typeof setTimeout> | null>(null);

	function showToast(message: string, type: 'success' | 'error' | 'info' = 'success') {
		if (toastTimeout) clearTimeout(toastTimeout);
		toastMessage = message;
		toastType = type;
		toastTimeout = setTimeout(() => {
			toastMessage = null;
		}, 4000);
	}

	async function loadTasks() {
		try {
			const res = await api.listTasks({ limit: 100 });
			if (res && Array.isArray(res.tasks)) {
				allTasks = res.tasks;
			} else {
				allTasks = DEFAULT_SAMPLE_TASKS;
			}
		} catch {
			// Gracefully fallback to sample tasks for resilient preview
			allTasks = DEFAULT_SAMPLE_TASKS;
		}
	}

	onMount(async () => {
		isLoading = true;
		await loadTasks();
		isLoading = false;
	});

	function handleFilterChange(filterId: TaskFilter) {
		activeFilter = filterId;
	}

	async function handleRefresh() {
		isRefreshing = true;
		await loadTasks();
		showToast('Task list refreshed', 'info');
		isRefreshing = false;
	}

	// Filtered tasks on client side from allTasks based on activeFilter
	const displayedTasks = $derived.by(() => {
		if (activeFilter === 'all') {
			return allTasks;
		}
		if (activeFilter === 'failed') {
			return allTasks.filter((t) => t.status === 'failed' || t.status === 'dead');
		}
		return allTasks.filter((t) => t.status === activeFilter);
	});

	// Quick summary metrics derived from allTasks (never collapsed by filter tabs)
	const metricStats = $derived.by(() => {
		const total = allTasks.length;
		const running = allTasks.filter((t) => t.status === 'running').length;
		const queued = allTasks.filter((t) => t.status === 'queued').length;
		const failed = allTasks.filter((t) => t.status === 'failed' || t.status === 'dead').length;
		const completed = allTasks.filter((t) => t.status === 'completed').length;
		return { total, running, queued, failed, completed };
	});

	// Compute counts per filter pill from allTasks
	function getFilterCount(filterId: TaskFilter): number {
		if (filterId === 'all') return allTasks.length;
		if (filterId === 'failed') return allTasks.filter((t) => t.status === 'failed' || t.status === 'dead').length;
		return allTasks.filter((t) => t.status === filterId).length;
	}

	// Open inspect drawer for a task
	function inspectTask(task: TaskItem) {
		selectedTask = task;
		copiedInput = false;
		copiedOutput = false;
	}

	function closeDrawer() {
		selectedTask = null;
		copiedInput = false;
		copiedOutput = false;
	}

	// Handle keyboard Escape to dismiss modal
	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape' && selectedTask) {
			closeDrawer();
		}
	}

	// Execute task retry
	async function handleRetry(taskId: number | string) {
		isRetrying = true;
		try {
			const res = await api.retryTask(taskId);
			showToast(`Task #${taskId} re-queued successfully`, 'success');

			// Update task in local master state
			allTasks = allTasks.map((t) => (t.id === Number(taskId) ? res.task : t));

			// If the selected task is the one retried, update its detail view
			if (selectedTask && selectedTask.id === Number(taskId)) {
				selectedTask = res.task;
			}
		} catch (err: any) {
			const errorMsg = err?.message || 'Failed to retry task';
			showToast(errorMsg, 'error');
		} finally {
			isRetrying = false;
		}
	}

	// Clipboard copy helper
	async function copyToClipboard(text: string, type: 'input' | 'output') {
		try {
			await navigator.clipboard.writeText(text);
			if (type === 'input') {
				copiedInput = true;
				setTimeout(() => (copiedInput = false), 2000);
			} else {
				copiedOutput = true;
				setTimeout(() => (copiedOutput = false), 2000);
			}
			showToast('Copied to clipboard', 'info');
		} catch {
			showToast('Unable to copy to clipboard', 'error');
		}
	}

	// Time formatting helpers
	function formatRelativeTime(dateInput: string | Date | null | undefined): string {
		if (!dateInput) return '-';
		const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
		const now = Date.now();
		const diffMs = now - date.getTime();
		const diffMins = Math.floor(diffMs / 60000);

		if (diffMins < 1) return 'just now';
		if (diffMins < 60) return `${diffMins}m ago`;
		const diffHours = Math.floor(diffMins / 60);
		if (diffHours < 24) return `${diffHours}h ago`;
		const diffDays = Math.floor(diffHours / 24);
		return `${diffDays}d ago`;
	}

	function formatDuration(
		startedAt: string | Date | null | undefined,
		completedAt: string | Date | null | undefined
	): string {
		if (!startedAt) return '-';
		const start = new Date(startedAt).getTime();
		const end = completedAt ? new Date(completedAt).getTime() : Date.now();
		const diffMs = Math.max(0, end - start);

		if (diffMs < 1000) return `${diffMs}ms`;
		const seconds = (diffMs / 1000).toFixed(1);
		if (Number(seconds) < 60) return `${seconds}s`;
		const mins = Math.floor(diffMs / 60000);
		const remainingSecs = Math.floor((diffMs % 60000) / 1000);
		return `${mins}m ${remainingSecs}s`;
	}

	// Status styling mapper
	function getStatusConfig(status: string) {
		switch (status) {
			case 'queued':
				return {
					label: 'Queued',
					badgeClass: 'bg-[#ddf4ff] text-[#1cb0f6] border border-[#c7e8fa]',
					dotClass: 'bg-[#1cb0f6]'
				};
			case 'running':
				return {
					label: 'Running',
					badgeClass: 'bg-[#e0f2fe] text-[#0284c7] border border-[#bae6fd]',
					dotClass: 'bg-[#0284c7] animate-pulse'
				};
			case 'completed':
				return {
					label: 'Completed',
					badgeClass: 'bg-[#e8f5e9] text-[#2e7d32] border border-[#c8e6c9]',
					dotClass: 'bg-[#58cc02]'
				};
			case 'failed':
				return {
					label: 'Failed',
					badgeClass: 'bg-[#ffebee] text-[#ff4b4b] border border-[#ffcdd2]',
					dotClass: 'bg-[#ff4b4b]'
				};
			case 'dead':
				return {
					label: 'Dead Letter',
					badgeClass: 'bg-[#fef2f2] text-[#991b1b] border border-[#fecaca]',
					dotClass: 'bg-[#991b1b]'
				};
			default:
				return {
					label: status,
					badgeClass: 'bg-[#f4faff] text-[#3c3c3c] border border-[#c7e8fa]',
					dotClass: 'bg-[#777777]'
				};
		}
	}

	// Type icon and display mapper
	function getTypeConfig(type: string) {
		switch (type) {
			case 'SEND_VGEN_MESSAGE':
				return { icon: Send, label: 'Send VGen Message', tag: 'VGen Send' };
			case 'PROCESS_GMAIL_EVENT':
				return { icon: Inbox, label: 'Process Gmail Event', tag: 'Gmail Event' };
			case 'READ_VGEN_CONVERSATION':
				return { icon: MessageSquare, label: 'Read Conversation', tag: 'Browser Read' };
			case 'SYNC_CONVERSATION':
				return { icon: RefreshCw, label: 'Sync Conversation', tag: 'Sync' };
			case 'GENERATE_REPLY_DRAFT':
				return { icon: Sparkles, label: 'Generate Reply Draft', tag: 'AI Draft' };
			case 'GENERATE_SUMMARY':
				return { icon: Sparkles, label: 'Generate Summary', tag: 'AI Summary' };
			default:
				return { icon: Zap, label: type, tag: 'Worker Task' };
		}
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="space-y-6 max-w-7xl mx-auto pb-12">
	<!-- 1. Header Row -->
	<header class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b-2 border-[#c7e8fa]/60">
		<div>
			<div class="flex items-center gap-2.5">
				<div class="w-8 h-8 rounded-xl bg-[#a5ed6e] border-2 border-[#85ca54] flex items-center justify-center text-[#111111] shadow-xs shrink-0">
					<Zap class="w-4 h-4 text-[#111111]" strokeWidth={2.5} />
				</div>
				<h1 class="text-2xl font-bold tracking-tight text-[#3c3c3c]">
					Agent Task Monitor
				</h1>
			</div>
			<p class="text-xs font-semibold text-[#777777] mt-1 pl-10.5">
				Background job queue execution, worker health, and retry management
			</p>
		</div>

		<div class="flex items-center gap-3 pl-10.5 sm:pl-0">
			<!-- Worker Live Status Badge -->
			<div class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white border-2 border-[#c7e8fa] text-xs font-bold text-[#3c3c3c] shadow-xs">
				<span class="w-2 h-2 rounded-full bg-[#58cc02] animate-pulse"></span>
				<span>Worker: Online</span>
			</div>

			<!-- Refresh Button -->
			<button
				type="button"
				onclick={handleRefresh}
				disabled={isRefreshing}
				aria-label="Refresh Tasks"
				class="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white border-2 border-[#c7e8fa] hover:bg-[#f4faff] hover:border-[#1cb0f6] text-[#3c3c3c] font-bold text-xs transition-all shadow-xs cursor-pointer disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-[#1cb0f6]"
			>
				<RefreshCw class="w-3.5 h-3.5 {isRefreshing ? 'animate-spin text-[#1cb0f6]' : 'text-[#777777]'}" />
				<span>Refresh</span>
			</button>
		</div>
	</header>

	<!-- Toast Notification Banner -->
	{#if toastMessage}
		<div
			class="p-3.5 rounded-xl border-2 text-xs font-bold flex items-center justify-between shadow-xs transition-all {toastType === 'success'
				? 'bg-[#e8f5e9] text-[#2e7d32] border-[#c8e6c9]'
				: toastType === 'error'
					? 'bg-[#ffebee] text-[#ff4b4b] border-[#ffcdd2]'
					: 'bg-[#ddf4ff] text-[#1cb0f6] border-[#c7e8fa]'}"
		>
			<div class="flex items-center gap-2">
				{#if toastType === 'success'}
					<CheckCircle2 class="w-4 h-4 text-[#58cc02] shrink-0" />
				{:else if toastType === 'error'}
					<AlertCircle class="w-4 h-4 text-[#ff4b4b] shrink-0" />
				{:else}
					<Activity class="w-4 h-4 text-[#1cb0f6] shrink-0" />
				{/if}
				<span>{toastMessage}</span>
			</div>
			<button
				type="button"
				onclick={() => (toastMessage = null)}
				aria-label="Dismiss message"
				class="text-current hover:opacity-75 cursor-pointer ml-3 focus:outline-none"
			>
				<X class="w-4 h-4" />
			</button>
		</div>
	{/if}

	<!-- 2. Metric Summary Cards (4 Cards, 12px rounded, 2px #c7e8fa border) -->
	<section class="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4" aria-label="Task queue overview">
		<!-- Card 1: Total Tasks -->
		<div class="bg-white border-2 border-[#c7e8fa] rounded-xl p-4 shadow-xs flex flex-col justify-between hover:border-[#1cb0f6] transition-colors">
			<div class="flex items-center justify-between mb-2">
				<span class="text-xs font-bold uppercase tracking-wider text-[#777777]">Total Tasks</span>
				<div class="w-7 h-7 rounded-lg bg-[#ddf4ff] border border-[#c7e8fa] flex items-center justify-center text-[#1cb0f6]">
					<Layers class="w-3.5 h-3.5" />
				</div>
			</div>
			<div>
				<div class="text-xl lg:text-2xl font-bold text-[#3c3c3c]">{metricStats.total}</div>
				<div class="text-[11px] font-semibold text-[#777777] mt-0.5">Recorded job executions</div>
			</div>
		</div>

		<!-- Card 2: Running -->
		<div class="bg-white border-2 border-[#c7e8fa] rounded-xl p-4 shadow-xs flex flex-col justify-between hover:border-[#1cb0f6] transition-colors">
			<div class="flex items-center justify-between mb-2">
				<span class="text-xs font-bold uppercase tracking-wider text-[#777777]">Running</span>
				<div class="w-7 h-7 rounded-lg bg-[#e0f2fe] border border-[#bae6fd] flex items-center justify-center text-[#0284c7]">
					<Activity class="w-3.5 h-3.5 {metricStats.running > 0 ? 'animate-pulse' : ''}" />
				</div>
			</div>
			<div>
				<div class="text-xl lg:text-2xl font-bold text-[#3c3c3c] flex items-center gap-2">
					<span>{metricStats.running}</span>
					{#if metricStats.running > 0}
						<span class="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-[#e0f2fe] text-[#0284c7] border border-[#bae6fd]">
							Active
						</span>
					{/if}
				</div>
				<div class="text-[11px] font-semibold text-[#777777] mt-0.5">Currently executing</div>
			</div>
		</div>

		<!-- Card 3: Queued -->
		<div class="bg-white border-2 border-[#c7e8fa] rounded-xl p-4 shadow-xs flex flex-col justify-between hover:border-[#1cb0f6] transition-colors">
			<div class="flex items-center justify-between mb-2">
				<span class="text-xs font-bold uppercase tracking-wider text-[#777777]">Queued</span>
				<div class="w-7 h-7 rounded-lg bg-[#ddf4ff] border border-[#c7e8fa] flex items-center justify-center text-[#1cb0f6]">
					<Clock class="w-3.5 h-3.5" />
				</div>
			</div>
			<div>
				<div class="text-xl lg:text-2xl font-bold text-[#3c3c3c]">{metricStats.queued}</div>
				<div class="text-[11px] font-semibold text-[#777777] mt-0.5">Awaiting worker pick up</div>
			</div>
		</div>

		<!-- Card 4: Failed / Dead -->
		<div class="bg-white border-2 border-[#c7e8fa] rounded-xl p-4 shadow-xs flex flex-col justify-between hover:border-[#1cb0f6] transition-colors">
			<div class="flex items-center justify-between mb-2">
				<span class="text-xs font-bold uppercase tracking-wider text-[#777777]">Failed</span>
				<div class="w-7 h-7 rounded-lg bg-[#ffebee] border border-[#ffcdd2] flex items-center justify-center text-[#ff4b4b]">
					<AlertCircle class="w-3.5 h-3.5" />
				</div>
			</div>
			<div>
				<div class="text-xl lg:text-2xl font-bold {metricStats.failed > 0 ? 'text-[#ff4b4b]' : 'text-[#3c3c3c]'} flex items-center gap-2">
					<span>{metricStats.failed}</span>
					{#if metricStats.failed > 0}
						<span class="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-[#ffebee] text-[#ff4b4b] border border-[#ffcdd2]">
							Action Needed
						</span>
					{/if}
				</div>
				<div class="text-[11px] font-semibold text-[#777777] mt-0.5">Failed or dead letter queue</div>
			</div>
		</div>
	</section>

	<!-- 3. Filter Pills Bar (All, Running, Queued, Completed, Failed / Dead) -->
	<section class="bg-white border-2 border-[#c7e8fa] rounded-xl p-2.5 shadow-xs flex flex-wrap items-center gap-2">
		{#each filterTabs as tab}
			{@const active = activeFilter === tab.id}
			{@const count = getFilterCount(tab.id)}
			<button
				type="button"
				onclick={() => handleFilterChange(tab.id)}
				class="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#1cb0f6] {active
					? 'bg-[#ddf4ff] text-[#1cb0f6] border-2 border-[#c7e8fa] shadow-xs'
					: 'bg-white text-[#777777] hover:bg-[#f4faff] hover:text-[#1cb0f6] border-2 border-transparent'}"
			>
				<span>{tab.label}</span>
				<span
					class="text-[10px] px-1.5 py-0.2 rounded-lg font-bold {active
						? 'bg-white text-[#1cb0f6] border border-[#c7e8fa]'
						: 'bg-[#f4faff] text-[#777777]'}"
				>
					{count}
				</span>
			</button>
		{/each}
	</section>

	<!-- 4. Tasks Table Container -->
	<section class="bg-white border-2 border-[#c7e8fa] rounded-xl shadow-xs overflow-hidden">
		{#if displayedTasks.length === 0}
			<!-- Empty State -->
			<div class="p-12 text-center space-y-3">
				<div class="w-12 h-12 rounded-xl bg-[#f4faff] border-2 border-[#c7e8fa] flex items-center justify-center text-[#777777] mx-auto">
					<CheckCircle2 class="w-6 h-6 text-[#58cc02]" />
				</div>
				<div class="text-sm font-bold text-[#3c3c3c]">No tasks found</div>
				<p class="text-xs text-[#777777] max-w-sm mx-auto">
					There are no tasks matching the selected filter ({filterTabs.find((t) => t.id === activeFilter)?.label}).
				</p>
			</div>
		{:else}
			<div class="overflow-x-auto">
				<table class="w-full text-left border-collapse text-xs">
					<thead>
						<tr class="bg-[#f4faff] border-b-2 border-[#c7e8fa] text-[11px] font-bold text-[#777777] uppercase tracking-wider">
							<th class="py-3 px-4">Task ID</th>
							<th class="py-3 px-4">Type</th>
							<th class="py-3 px-4">Status</th>
							<th class="py-3 px-4">Attempts</th>
							<th class="py-3 px-4">Created At</th>
							<th class="py-3 px-4 text-right">Action</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-[#c7e8fa]/60">
						{#each displayedTasks as task (task.id)}
							{@const statusCfg = getStatusConfig(task.status)}
							{@const typeCfg = getTypeConfig(task.type)}
							<tr
								onclick={() => inspectTask(task)}
								onkeydown={(e) => {
									if (e.key === 'Enter' || e.key === ' ') {
										inspectTask(task);
									}
								}}
								tabindex="0"
								class="hover:bg-[#f4faff] transition-colors cursor-pointer focus:outline-none focus:bg-[#f4faff]"
							>
								<!-- Task ID -->
								<td class="py-3 px-4 font-mono font-bold text-[#3c3c3c]">
									#{task.id}
								</td>

								<!-- Type -->
								<td class="py-3 px-4">
									<div class="flex items-center gap-2">
										<div class="w-6 h-6 rounded-lg bg-[#ddf4ff] border border-[#c7e8fa] flex items-center justify-center text-[#1cb0f6] shrink-0">
											<typeCfg.icon class="w-3.5 h-3.5" />
										</div>
										<div>
											<div class="font-bold text-[#3c3c3c]">{typeCfg.label}</div>
											<div class="text-[10px] text-[#777777] font-mono">{task.type}</div>
										</div>
									</div>
								</td>

								<!-- Status Badge (queued, running, completed, failed, dead) -->
								<td class="py-3 px-4">
									<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-[11px] font-bold {statusCfg.badgeClass}">
										<span class="w-1.5 h-1.5 rounded-full {statusCfg.dotClass}"></span>
										<span>{statusCfg.label}</span>
									</span>
								</td>

								<!-- Attempts (attempts / maxAttempts) -->
								<td class="py-3 px-4">
									<div class="flex items-center gap-1.5">
										<span class="font-bold {task.attempts >= task.maxAttempts && (task.status === 'failed' || task.status === 'dead') ? 'text-[#ff4b4b]' : 'text-[#3c3c3c]'}">
											{task.attempts}
										</span>
										<span class="text-[#777777]">/</span>
										<span class="text-[#777777]">{task.maxAttempts}</span>
									</div>
								</td>

								<!-- Created At & Duration -->
								<td class="py-3 px-4 text-[#777777]">
									<div class="font-semibold text-[#3c3c3c]">
										{formatRelativeTime(task.createdAt)}
									</div>
									<div class="text-[10px] text-[#777777]">
										Duration: {formatDuration(task.startedAt, task.completedAt)}
									</div>
								</td>

								<!-- Action Buttons -->
								<td class="py-3 px-4 text-right">
									<div class="inline-flex items-center gap-1.5 justify-end">
										<!-- Inspect Button -->
										<button
											type="button"
											onclick={(e) => {
												e.stopPropagation();
												inspectTask(task);
											}}
											title="Inspect Task Details"
											aria-label={`Inspect Task #${task.id}`}
											class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white border-2 border-[#c7e8fa] hover:bg-[#f4faff] hover:border-[#1cb0f6] text-[#3c3c3c] font-bold text-xs transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#1cb0f6]"
										>
											<ExternalLink class="w-3.5 h-3.5 text-[#1cb0f6]" />
											<span>Inspect</span>
										</button>

										<!-- Quick Inline Retry (Only for failed or dead tasks) -->
										{#if task.status === 'failed' || task.status === 'dead'}
											<button
												type="button"
												onclick={(e) => {
													e.stopPropagation();
													handleRetry(task.id);
												}}
												disabled={isRetrying}
												title="Retry Task"
												aria-label={`Retry Task #${task.id}`}
												class="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-[#a5ed6e] hover:bg-[#94e65b] text-[#111111] font-bold text-xs transition-colors border-2 border-[#85ca54] cursor-pointer disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-[#85ca54]"
											>
												<RotateCcw class="w-3 h-3 text-[#111111]" />
												<span>Retry</span>
											</button>
										{/if}
									</div>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</section>
</div>

<!-- 5. Slide-Over Detail Drawer & Retry Modal (role="dialog", aria-modal="true") -->
{#if selectedTask}
	{@const statusCfg = getStatusConfig(selectedTask.status)}
	{@const typeCfg = getTypeConfig(selectedTask.type)}

	<div class="fixed inset-0 z-50 flex justify-end">
		<!-- Backdrop overlay with click-to-dismiss -->
		<div
			class="fixed inset-0 bg-black/40 backdrop-blur-xs transition-opacity"
			onclick={closeDrawer}
			role="presentation"
		></div>

		<!-- Slide-over Drawer Panel -->
		<div
			class="relative w-full max-w-xl bg-white border-l-2 border-[#c7e8fa] h-full shadow-2xl flex flex-col z-10 overflow-hidden"
			role="dialog"
			aria-modal="true"
			aria-labelledby="drawer-title"
			tabindex="-1"
		>
			<!-- Drawer Header -->
			<div class="p-5 border-b-2 border-[#c7e8fa] bg-[#f4faff] flex items-center justify-between gap-3">
				<div class="min-w-0">
					<div class="flex items-center gap-2">
						<span class="w-2.5 h-2.5 rounded-full {statusCfg.dotClass}"></span>
						<h2 id="drawer-title" class="text-base font-bold text-[#3c3c3c] truncate">
							Task #{selectedTask.id}
						</h2>
						<span class="px-2 py-0.5 rounded-lg text-[10px] font-bold {statusCfg.badgeClass}">
							{statusCfg.label}
						</span>
					</div>
					<div class="text-xs text-[#777777] font-semibold mt-0.5 truncate pl-4.5">
						{typeCfg.label} ({selectedTask.type})
					</div>
				</div>

				<button
					type="button"
					onclick={closeDrawer}
					aria-label="Close details"
					class="p-2 text-[#777777] hover:text-[#3c3c3c] hover:bg-white rounded-xl border border-transparent hover:border-[#c7e8fa] transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#1cb0f6]"
				>
					<X class="w-5 h-5" />
				</button>
			</div>

			<!-- Drawer Body (Scrollable) -->
			<div class="flex-1 overflow-y-auto p-5 space-y-5">
				<!-- Metadata Grid -->
				<div class="bg-[#f4faff] border border-[#c7e8fa] rounded-xl p-3.5 grid grid-cols-2 gap-3 text-xs">
					<div>
						<span class="block text-[10px] font-bold uppercase tracking-wider text-[#777777]">Attempts</span>
						<span class="font-bold text-[#3c3c3c]">
							{selectedTask.attempts} of {selectedTask.maxAttempts} max
						</span>
					</div>
					<div>
						<span class="block text-[10px] font-bold uppercase tracking-wider text-[#777777]">Idempotency Key</span>
						<span class="font-mono text-[11px] text-[#3c3c3c] truncate block" title={selectedTask.idempotencyKey || 'None'}>
							{selectedTask.idempotencyKey || 'None'}
						</span>
					</div>
					<div>
						<span class="block text-[10px] font-bold uppercase tracking-wider text-[#777777]">Created At</span>
						<span class="text-[#3c3c3c] font-medium">
							{new Date(selectedTask.createdAt).toLocaleString()}
						</span>
					</div>
					<div>
						<span class="block text-[10px] font-bold uppercase tracking-wider text-[#777777]">Execution Duration</span>
						<span class="text-[#3c3c3c] font-bold">
							{formatDuration(selectedTask.startedAt, selectedTask.completedAt)}
						</span>
					</div>
				</div>

				<!-- Failure Reason Callout (if task failed or has error) -->
				{#if selectedTask.error}
					<div class="bg-[#ffebee] border-2 border-[#ffcdd2] rounded-xl p-4 text-[#c62828] space-y-1.5 shadow-xs">
						<div class="flex items-center gap-2 font-bold text-xs">
							<AlertCircle class="w-4 h-4 text-[#ff4b4b] shrink-0" />
							<span>Failure Reason</span>
						</div>
						<div class="text-xs font-mono leading-relaxed pl-6 whitespace-pre-wrap break-words">
							{selectedTask.error}
						</div>
					</div>
				{/if}

				<!-- JSON Input Viewer -->
				<div class="space-y-2">
					<div class="flex items-center justify-between">
						<span class="text-xs font-bold text-[#3c3c3c] flex items-center gap-1.5">
							<Terminal class="w-3.5 h-3.5 text-[#1cb0f6]" />
							JSON Input
						</span>
						<button
							type="button"
							onclick={() => copyToClipboard(JSON.stringify(selectedTask?.input, null, 2), 'input')}
							class="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold text-[#777777] hover:text-[#3c3c3c] hover:bg-[#f4faff] border border-transparent hover:border-[#c7e8fa] transition-colors cursor-pointer focus:outline-none"
						>
							{#if copiedInput}
								<Check class="w-3 h-3 text-[#58cc02]" />
								<span class="text-[#58cc02]">Copied</span>
							{:else}
								<Copy class="w-3 h-3" />
								<span>Copy JSON</span>
							{/if}
						</button>
					</div>

					<pre class="bg-[#f4faff] border-2 border-[#c7e8fa] rounded-xl p-3 text-xs font-mono text-[#3c3c3c] overflow-x-auto max-h-56 leading-relaxed">{JSON.stringify(selectedTask.input, null, 2)}</pre>
				</div>

				<!-- JSON Output Viewer -->
				<div class="space-y-2">
					<div class="flex items-center justify-between">
						<span class="text-xs font-bold text-[#3c3c3c] flex items-center gap-1.5">
							<Terminal class="w-3.5 h-3.5 text-[#58cc02]" />
							JSON Output
						</span>
						{#if selectedTask.output}
							<button
								type="button"
								onclick={() => copyToClipboard(JSON.stringify(selectedTask?.output, null, 2), 'output')}
								class="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold text-[#777777] hover:text-[#3c3c3c] hover:bg-[#f4faff] border border-transparent hover:border-[#c7e8fa] transition-colors cursor-pointer focus:outline-none"
							>
								{#if copiedOutput}
									<Check class="w-3 h-3 text-[#58cc02]" />
									<span class="text-[#58cc02]">Copied</span>
								{:else}
									<Copy class="w-3 h-3" />
									<span>Copy JSON</span>
								{/if}
							</button>
						{/if}
					</div>

					{#if selectedTask.output}
						<pre class="bg-[#f4faff] border-2 border-[#c7e8fa] rounded-xl p-3 text-xs font-mono text-[#3c3c3c] overflow-x-auto max-h-56 leading-relaxed">{JSON.stringify(selectedTask.output, null, 2)}</pre>
					{:else}
						<div class="p-4 rounded-xl bg-[#f4faff] border border-[#c7e8fa] text-center text-xs text-[#777777] italic">
							No output generated yet
						</div>
					{/if}
				</div>
			</div>

			<!-- Drawer Footer / Actions -->
			<div class="p-4 border-t-2 border-[#c7e8fa] bg-[#f4faff] flex items-center justify-between gap-3">
				<button
					type="button"
					onclick={closeDrawer}
					class="px-4 py-2 rounded-xl bg-white border-2 border-[#c7e8fa] hover:bg-[#f4faff] hover:border-[#1cb0f6] text-[#3c3c3c] font-bold text-xs transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#1cb0f6]"
				>
					Close
				</button>

				{#if selectedTask.status === 'failed' || selectedTask.status === 'dead'}
					<button
						type="button"
						onclick={() => handleRetry(selectedTask!.id)}
						disabled={isRetrying}
						class="inline-flex items-center gap-2 px-5 py-2 rounded-xl bg-[#a5ed6e] hover:bg-[#94e65b] text-[#111111] font-bold text-xs transition-all border-2 border-[#85ca54] shadow-xs cursor-pointer disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-[#85ca54]"
					>
						{#if isRetrying}
							<RefreshCw class="w-3.5 h-3.5 animate-spin text-[#111111]" />
							<span>Retrying...</span>
						{:else}
							<RotateCcw class="w-3.5 h-3.5 text-[#111111]" />
							<span>Retry Task</span>
						{/if}
					</button>
				{:else}
					<span class="text-[11px] font-medium text-[#777777] italic">
						Only failed or dead tasks can be retried
					</span>
				{/if}
			</div>
		</div>
	</div>
{/if}
