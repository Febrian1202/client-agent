<script lang="ts">
	import { page } from '$app/state';
	import {
		api,
		type ClientItem,
		type CommissionItem,
		type ClientMemoryItem,
	} from '$lib/api';
	import {
		DEFAULT_SAMPLE_CLIENTS,
		DEFAULT_SAMPLE_COMMISSIONS,
		getClientMemoryProfile,
		formatRelativeTime
	} from '$lib/dashboard';
	import {
		ArrowLeft,
		Users,
		ExternalLink,
		MessageSquare,
		Calendar,
		Clock,
		ShieldCheck,
		Sparkles,
		Briefcase,
		CheckCircle2,
		AlertCircle,
		DollarSign,
		Bookmark,
		Plus,
		Pencil,
		Trash2,
		X,
		Tag
	} from 'lucide-svelte';

	let client = $state<ClientItem | null>(null);
	let commissions = $state<CommissionItem[]>([]);
	let memories = $state<ClientMemoryItem[]>([]);
	let isLoading = $state(true);
	let errorMessage = $state<string | null>(null);

	// Modal State
	let isMemoryModalOpen = $state(false);
	let isSubmittingMemory = $state(false);
	let memoryFormError = $state<string | null>(null);
	let editingMemoryId = $state<number | null>(null);

	let formType = $state<'fact' | 'preference' | 'inference'>('fact');
	let formCategory = $state<'technical' | 'scope' | 'assets' | 'general' | 'communication'>('technical');
	let formContent = $state('');

	const clientId = $derived(Number(page.params.id));

	const facts = $derived(memories.filter((m) => m.type.toLowerCase() === 'fact'));
	const preferences = $derived(memories.filter((m) => m.type.toLowerCase() === 'preference'));
	const inferences = $derived(memories.filter((m) => m.type.toLowerCase() === 'inference'));

	async function loadClientData() {
		isLoading = true;
		errorMessage = null;

		if (Number.isNaN(clientId) || clientId <= 0) {
			errorMessage = 'Invalid client ID';
			isLoading = false;
			return;
		}

		try {
			// Fetch client details
			try {
				const clientRes = await api.getClient(clientId);
				client = clientRes;
			} catch (err: any) {
				const fallback = DEFAULT_SAMPLE_CLIENTS.find((c) => c.id === clientId);
				if (fallback) {
					client = fallback;
				} else {
					client = null;
					errorMessage = err.message || 'Client not found';
					return;
				}
			}

			// Fetch commissions for this client
			try {
				const commRes = await api.listCommissions({ clientId });
				if (commRes && commRes.length > 0) {
					commissions = commRes;
				} else {
					commissions = DEFAULT_SAMPLE_COMMISSIONS.filter(
						(c) =>
							c.clientId === clientId ||
							c.clientUsername?.toLowerCase() === client?.username.toLowerCase()
					);
				}
			} catch {
				commissions = DEFAULT_SAMPLE_COMMISSIONS.filter(
					(c) =>
						c.clientId === clientId ||
						c.clientUsername?.toLowerCase() === client?.username.toLowerCase()
				);
			}

			// Fetch memories for this client
			try {
				const memRes = await api.listClientMemories(clientId);
				if (memRes && memRes.memories && memRes.memories.length > 0) {
					memories = memRes.memories;
				} else {
					// Fallback to sample memory tags if database has none yet
					const sample = getClientMemoryProfile(client?.username);
					memories = [
						...sample.facts.map((f, i) => ({
							id: -(i + 1),
							clientId,
							type: 'fact',
							category: 'technical',
							content: f.text,
							source: 'user_note',
							confidence: 'high',
							createdAt: new Date(),
							updatedAt: new Date(),
						})),
						...sample.preferences.map((p, i) => ({
							id: -(i + 10),
							clientId,
							type: 'preference',
							category: 'scope',
							content: p.text,
							source: 'user_note',
							confidence: 'high',
							createdAt: new Date(),
							updatedAt: new Date(),
						})),
						...sample.inferences.map((inf, i) => ({
							id: -(i + 20),
							clientId,
							type: 'inference',
							category: 'general',
							content: inf.text,
							source: 'agent_inference',
							confidence: 'medium',
							createdAt: new Date(),
							updatedAt: new Date(),
						})),
					];
				}
			} catch {
				const sample = getClientMemoryProfile(client?.username);
				memories = [
					...sample.facts.map((f, i) => ({
						id: -(i + 1),
						clientId,
						type: 'fact',
						category: 'technical',
						content: f.text,
						source: 'user_note',
						confidence: 'high',
						createdAt: new Date(),
						updatedAt: new Date(),
					})),
					...sample.preferences.map((p, i) => ({
						id: -(i + 10),
						clientId,
						type: 'preference',
						category: 'scope',
						content: p.text,
						source: 'user_note',
						confidence: 'high',
						createdAt: new Date(),
						updatedAt: new Date(),
					})),
					...sample.inferences.map((inf, i) => ({
						id: -(i + 20),
						clientId,
						type: 'inference',
						category: 'general',
						content: inf.text,
						source: 'agent_inference',
						confidence: 'medium',
						createdAt: new Date(),
						updatedAt: new Date(),
					})),
				];
			}
		} catch (err: any) {
			errorMessage = err.message || 'Failed to load client details';
		} finally {
			isLoading = false;
		}
	}

	$effect(() => {
		if (page.params.id) {
			loadClientData();
		}
	});

	function openAddMemoryModal(defaultType: 'fact' | 'preference' | 'inference' = 'fact') {
		editingMemoryId = null;
		formType = defaultType;
		formCategory = defaultType === 'preference' ? 'scope' : 'technical';
		formContent = '';
		memoryFormError = null;
		isMemoryModalOpen = true;
	}

	function openEditMemoryModal(memory: ClientMemoryItem) {
		editingMemoryId = memory.id;
		formType = (memory.type as any) || 'fact';
		formCategory = (memory.category as any) || 'general';
		formContent = memory.content;
		memoryFormError = null;
		isMemoryModalOpen = true;
	}

	function closeMemoryModal() {
		isMemoryModalOpen = false;
		editingMemoryId = null;
		formContent = '';
		memoryFormError = null;
	}

	async function handleSaveMemory() {
		if (!formContent.trim()) {
			memoryFormError = 'Memory content cannot be empty';
			return;
		}

		isSubmittingMemory = true;
		memoryFormError = null;

		try {
			if (editingMemoryId !== null && editingMemoryId > 0) {
				const updated = await api.updateClientMemory(clientId, editingMemoryId, formContent.trim());
				memories = memories.map((m) => (m.id === editingMemoryId ? updated : m));
			} else if (editingMemoryId !== null && editingMemoryId < 0) {
				// Updating a sample preview note locally
				memories = memories.map((m) =>
					m.id === editingMemoryId
						? { ...m, content: formContent.trim(), type: formType, category: formCategory, updatedAt: new Date() }
						: m
				);
			} else {
				const created = await api.createClientMemory(clientId, {
					type: formType,
					category: formCategory,
					content: formContent.trim(),
				});
				memories = [created, ...memories.filter((m) => m.id > 0)];
			}
			closeMemoryModal();
		} catch (err: any) {
			memoryFormError = err.message || 'Failed to save memory';
		} finally {
			isSubmittingMemory = false;
		}
	}

	async function handleDeleteMemory(memoryId: number) {
		if (!confirm('Are you sure you want to remove this memory note?')) {
			return;
		}

		try {
			if (memoryId > 0) {
				await api.deleteClientMemory(clientId, memoryId);
			}
			memories = memories.filter((m) => m.id !== memoryId);
		} catch (err: any) {
			alert(err.message || 'Failed to delete memory note');
		}
	}

	function getCategoryBadge(cat?: string) {
		const c = (cat || 'general').toLowerCase();
		switch (c) {
			case 'technical':
				return { label: 'Technical', bg: 'bg-[#e0f2fe]', text: 'text-[#0284c7]', border: 'border-[#bae6fd]' };
			case 'scope':
				return { label: 'Scope', bg: 'bg-[#fef3c7]', text: 'text-[#d97706]', border: 'border-[#fde68a]' };
			case 'assets':
				return { label: 'Assets', bg: 'bg-[#dcfce7]', text: 'text-[#16a34a]', border: 'border-[#bbf7d0]' };
			case 'communication':
				return { label: 'Communication', bg: 'bg-[#f3e8ff]', text: 'text-[#9333ea]', border: 'border-[#e9d5ff]' };
			default:
				return { label: 'General', bg: 'bg-[#f1f5f9]', text: 'text-[#475569]', border: 'border-[#e2e8f0]' };
		}
	}

	function formatDate(dateVal?: string | Date | null): string {
		if (!dateVal) return 'Not specified';
		try {
			const d = new Date(dateVal);
			return d.toLocaleDateString('en-US', {
				month: 'short',
				day: 'numeric',
				year: 'numeric'
			});
		} catch {
			return String(dateVal);
		}
	}

	function getInitial(name?: string | null): string {
		if (!name) return '?';
		const clean = name.replace(/^@/, '').trim();
		return clean.charAt(0).toUpperCase() || '?';
	}

	function getStatusBadge(status?: string) {
		const s = (status || 'requested').toLowerCase();
		if (s === 'completed') {
			return { label: 'Completed', color: '#58cc02', bg: 'bg-[#e8f5e9]', border: 'border-[#c8e6c9]' };
		}
		if (s === 'delivered') {
			return { label: 'Delivered', color: '#1cb0f6', bg: 'bg-[#ddf4ff]', border: 'border-[#c7e8fa]' };
		}
		if (s === 'in_progress' || s === 'accepted') {
			return { label: 'In Progress', color: '#2e7d32', bg: 'bg-[#e8f5e9]', border: 'border-[#c8e6c9]' };
		}
		return { label: 'Requested', color: '#ff9600', bg: 'bg-[#fff3e0]', border: 'border-[#ffe0b2]' };
	}
</script>

<svelte:head>
	<title>
		{client ? `${client.displayName || client.username} | Clients` : 'Client Profile'} | ClientAgent
	</title>
</svelte:head>

<div class="min-h-screen bg-[#ddf4ff] p-6 space-y-6">
	<!-- Navigation Breadcrumb / Back button -->
	<div>
		<a
			href="/clients"
			class="inline-flex items-center gap-2 text-xs font-bold text-[#1cb0f6] bg-white border-2 border-[#c7e8fa] px-3.5 py-2 rounded-xl hover:bg-[#f4faff] transition active:scale-95 shadow-sm"
		>
			<ArrowLeft class="w-4 h-4" />
			Back to Clients
		</a>
	</div>

	{#if isLoading}
		<div
			class="bg-white border-2 border-[#c7e8fa] rounded-xl p-12 text-center flex flex-col items-center justify-center gap-3"
		>
			<Clock class="w-8 h-8 text-[#1cb0f6] animate-spin" />
			<p class="text-sm font-bold text-[#777777]">Loading client profile...</p>
		</div>
	{:else if errorMessage || !client}
		<div class="bg-white border-2 border-[#c7e8fa] rounded-xl p-8 text-center max-w-lg mx-auto">
			<AlertCircle class="w-10 h-10 text-[#ff4b4b] mx-auto mb-3" />
			<h2 class="text-base font-black text-[#3c3c3c] mb-1">Client Not Found</h2>
			<p class="text-xs text-[#777777] mb-4">
				{errorMessage || 'The requested client record does not exist or could not be loaded.'}
			</p>
			<a
				href="/clients"
				class="inline-flex items-center gap-2 px-4 py-2 bg-[#1cb0f6] text-white rounded-xl font-bold text-xs hover:bg-[#1899d6] transition"
			>
				Return to Directory
			</a>
		</div>
	{:else}
		<!-- Client Profile Header Card -->
		<div class="bg-white border-2 border-[#c7e8fa] rounded-xl p-6 shadow-sm">
			<div class="flex flex-col md:flex-row md:items-center justify-between gap-6">
				<!-- Identity -->
				<div class="flex items-center gap-4">
					{#if client.avatarUrl}
						<img
							src={client.avatarUrl}
							alt={client.displayName || client.username}
							class="w-16 h-16 rounded-full object-cover border-2 border-[#c7e8fa] shadow-sm"
						/>
					{:else}
						<div
							class="w-16 h-16 rounded-full bg-[#ddf4ff] border-2 border-[#c7e8fa] text-[#1cb0f6] font-black text-2xl flex items-center justify-center shadow-sm"
						>
							{getInitial(client.displayName || client.username)}
						</div>
					{/if}

					<div>
						<div class="flex items-center gap-2.5 flex-wrap">
							<h1 class="text-2xl font-black text-[#3c3c3c] tracking-tight">
								{client.displayName || client.username}
							</h1>
							<span
								class="px-2.5 py-0.5 text-xs font-bold uppercase rounded-lg bg-[#ddf4ff] text-[#1cb0f6] border border-[#c7e8fa]"
							>
								{client.platform || 'vgen'}
							</span>
						</div>
						<p class="text-sm font-semibold text-[#777777] mt-0.5">
							@{client.username.replace(/^@/, '')}
						</p>
					</div>
				</div>

				<!-- Quick External Actions -->
				<div class="flex items-center gap-3 flex-wrap">
					<a
						href="https://vgen.co/{client.username.replace(/^@/, '')}"
						target="_blank"
						rel="noopener noreferrer"
						class="inline-flex items-center gap-2 px-4 py-2.5 bg-white border-2 border-[#c7e8fa] text-[#3c3c3c] rounded-xl font-bold text-xs hover:bg-[#f4faff] hover:border-[#1cb0f6] transition cursor-pointer"
					>
						<ExternalLink class="w-4 h-4 text-[#1cb0f6]" />
						Open on VGen
					</a>

					<a
						href="/conversations?client={client.username.replace(/^@/, '')}"
						class="inline-flex items-center gap-2 px-4 py-2.5 bg-[#a5ed6e] text-[#1b4332] border-2 border-[#8ee052] rounded-xl font-black text-xs hover:bg-[#8ee052] transition cursor-pointer shadow-sm active:scale-95"
					>
						<MessageSquare class="w-4 h-4" />
						Open Thread
					</a>
				</div>
			</div>

			<!-- Metadata Pills Row -->
			<div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6 pt-6 border-t border-[#f4faff]">
				<div class="bg-[#f4faff] border border-[#c7e8fa] rounded-xl p-3">
					<p class="text-xs text-[#777777] font-semibold flex items-center gap-1.5">
						<Calendar class="w-3.5 h-3.5 text-[#1cb0f6]" />
						First Seen
					</p>
					<p class="text-sm font-black text-[#3c3c3c] mt-1">{formatDate(client.firstSeenAt)}</p>
				</div>

				<div class="bg-[#f4faff] border border-[#c7e8fa] rounded-xl p-3">
					<p class="text-xs text-[#777777] font-semibold flex items-center gap-1.5">
						<Clock class="w-3.5 h-3.5 text-[#1cb0f6]" />
						Last Seen
					</p>
					<p class="text-sm font-black text-[#3c3c3c] mt-1">{formatDate(client.lastSeenAt)}</p>
				</div>

				<div class="bg-[#f4faff] border border-[#c7e8fa] rounded-xl p-3">
					<p class="text-xs text-[#777777] font-semibold flex items-center gap-1.5">
						<Briefcase class="w-3.5 h-3.5 text-[#1cb0f6]" />
						Total Commissions
					</p>
					<p class="text-sm font-black text-[#3c3c3c] mt-1">
						{commissions.length} {commissions.length === 1 ? 'Order' : 'Orders'}
					</p>
				</div>

				<div class="bg-[#f4faff] border border-[#c7e8fa] rounded-xl p-3">
					<p class="text-xs text-[#777777] font-semibold flex items-center gap-1.5">
						<DollarSign class="w-3.5 h-3.5 text-[#1cb0f6]" />
						Platform Status
					</p>
					<p class="text-sm font-black text-[#58cc02] mt-1">Active Client</p>
				</div>
			</div>
		</div>

		<!-- Client Memory & Notes Card -->
		<div class="bg-white border-2 border-[#c7e8fa] rounded-xl p-6 shadow-sm space-y-5">
			<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
				<div class="flex items-center gap-3">
					<div
						class="w-10 h-10 rounded-xl bg-[#f3e5f5] border-2 border-[#e1bee7] flex items-center justify-center text-[#af71f5]"
					>
						<Sparkles class="w-5 h-5" />
					</div>
					<div>
						<h2 class="text-lg font-black text-[#3c3c3c] tracking-tight">
							Client Memory & Notes
						</h2>
						<p class="text-xs text-[#777777]">
							Structured technical specs, scope habits, and verified facts used by the AI agent
						</p>
					</div>
				</div>

				<button
					type="button"
					onclick={() => openAddMemoryModal('fact')}
					class="inline-flex items-center gap-2 px-4 py-2 bg-[#a5ed6e] text-[#1b4332] border-2 border-[#8ee052] rounded-xl font-black text-xs hover:bg-[#8ee052] transition cursor-pointer shadow-sm active:scale-95"
				>
					<Plus class="w-4 h-4" />
					Add Memory Note
				</button>
			</div>

			<!-- Memory Clusters -->
			<div class="grid grid-cols-1 md:grid-cols-3 gap-4">
				<!-- Facts Column -->
				<div class="bg-[#f4faff] border border-[#c7e8fa] rounded-xl p-4 space-y-3">
					<div class="flex items-center justify-between">
						<div class="flex items-center gap-2">
							<span
								class="px-2 py-0.5 text-xs font-black rounded-lg bg-[#e8f5e9] text-[#58cc02] border border-[#c8e6c9]"
							>
								FACT
							</span>
							<span class="text-xs font-bold text-[#777777]">Technical Specs ({facts.length})</span>
						</div>
						<button
							type="button"
							onclick={() => openAddMemoryModal('fact')}
							class="text-xs text-[#58cc02] font-black hover:underline cursor-pointer flex items-center gap-0.5"
						>
							<Plus class="w-3.5 h-3.5" />
						</button>
					</div>

					<div class="space-y-2.5">
						{#if facts.length === 0}
							<p class="text-xs text-[#777777] italic py-2">No verified facts recorded.</p>
						{:else}
							{#each facts as item (item.id)}
								{@const catBadge = getCategoryBadge(item.category)}
								<div
									class="p-3 bg-white border border-[#c8e6c9] rounded-xl text-xs space-y-2 shadow-xs group hover:border-[#58cc02] transition"
								>
									<div class="flex items-center justify-between gap-2">
										<span
											class="px-2 py-0.5 text-[10px] font-black uppercase rounded-md border {catBadge.bg} {catBadge.text} {catBadge.border}"
										>
											{catBadge.label}
										</span>

										<div class="flex items-center gap-1 opacity-80 group-hover:opacity-100 transition">
											<button
												type="button"
												onclick={() => openEditMemoryModal(item)}
												class="p-1 text-[#777777] hover:text-[#1cb0f6] rounded-md hover:bg-[#f4faff] transition cursor-pointer"
												title="Edit note"
											>
												<Pencil class="w-3 h-3" />
											</button>
											<button
												type="button"
												onclick={() => handleDeleteMemory(item.id)}
												class="p-1 text-[#777777] hover:text-[#ff4b4b] rounded-md hover:bg-[#fff0f0] transition cursor-pointer"
												title="Delete note"
											>
												<Trash2 class="w-3 h-3" />
											</button>
										</div>
									</div>

									<p class="font-semibold text-[#3c3c3c] leading-relaxed">{item.content}</p>
								</div>
							{/each}
						{/if}
					</div>
				</div>

				<!-- Preferences Column -->
				<div class="bg-[#f4faff] border border-[#c7e8fa] rounded-xl p-4 space-y-3">
					<div class="flex items-center justify-between">
						<div class="flex items-center gap-2">
							<span
								class="px-2 py-0.5 text-xs font-black rounded-lg bg-[#ddf4ff] text-[#1cb0f6] border border-[#c7e8fa]"
							>
								PREFERENCE
							</span>
							<span class="text-xs font-bold text-[#777777]">Scope Habits ({preferences.length})</span>
						</div>
						<button
							type="button"
							onclick={() => openAddMemoryModal('preference')}
							class="text-xs text-[#1cb0f6] font-black hover:underline cursor-pointer flex items-center gap-0.5"
						>
							<Plus class="w-3.5 h-3.5" />
						</button>
					</div>

					<div class="space-y-2.5">
						{#if preferences.length === 0}
							<p class="text-xs text-[#777777] italic py-2">No scope preferences recorded.</p>
						{:else}
							{#each preferences as item (item.id)}
								{@const catBadge = getCategoryBadge(item.category)}
								<div
									class="p-3 bg-white border border-[#c7e8fa] rounded-xl text-xs space-y-2 shadow-xs group hover:border-[#1cb0f6] transition"
								>
									<div class="flex items-center justify-between gap-2">
										<span
											class="px-2 py-0.5 text-[10px] font-black uppercase rounded-md border {catBadge.bg} {catBadge.text} {catBadge.border}"
										>
											{catBadge.label}
										</span>

										<div class="flex items-center gap-1 opacity-80 group-hover:opacity-100 transition">
											<button
												type="button"
												onclick={() => openEditMemoryModal(item)}
												class="p-1 text-[#777777] hover:text-[#1cb0f6] rounded-md hover:bg-[#f4faff] transition cursor-pointer"
												title="Edit preference"
											>
												<Pencil class="w-3 h-3" />
											</button>
											<button
												type="button"
												onclick={() => handleDeleteMemory(item.id)}
												class="p-1 text-[#777777] hover:text-[#ff4b4b] rounded-md hover:bg-[#fff0f0] transition cursor-pointer"
												title="Delete preference"
											>
												<Trash2 class="w-3 h-3" />
											</button>
										</div>
									</div>

									<p class="font-semibold text-[#3c3c3c] leading-relaxed">{item.content}</p>
								</div>
							{/each}
						{/if}
					</div>
				</div>

				<!-- Inferences Column -->
				<div class="bg-[#f4faff] border border-[#c7e8fa] rounded-xl p-4 space-y-3">
					<div class="flex items-center justify-between">
						<div class="flex items-center gap-2">
							<span
								class="px-2 py-0.5 text-xs font-black rounded-lg bg-[#f3e5f5] text-[#af71f5] border border-[#e1bee7]"
							>
								INFERENCE
							</span>
							<span class="text-xs font-bold text-[#777777]">AI Hypotheses ({inferences.length})</span>
						</div>
						<button
							type="button"
							onclick={() => openAddMemoryModal('inference')}
							class="text-xs text-[#af71f5] font-black hover:underline cursor-pointer flex items-center gap-0.5"
						>
							<Plus class="w-3.5 h-3.5" />
						</button>
					</div>

					<div class="space-y-2.5">
						{#if inferences.length === 0}
							<p class="text-xs text-[#777777] italic py-2">No unverified hypotheses recorded.</p>
						{:else}
							{#each inferences as item (item.id)}
								{@const catBadge = getCategoryBadge(item.category)}
								<div
									class="p-3 bg-white border border-[#e1bee7] rounded-xl text-xs space-y-2 shadow-xs group hover:border-[#af71f5] transition"
								>
									<div class="flex items-center justify-between gap-2">
										<span
											class="px-2 py-0.5 text-[10px] font-black uppercase rounded-md border {catBadge.bg} {catBadge.text} {catBadge.border}"
										>
											{catBadge.label}
										</span>

										<div class="flex items-center gap-1 opacity-80 group-hover:opacity-100 transition">
											<button
												type="button"
												onclick={() => openEditMemoryModal(item)}
												class="p-1 text-[#777777] hover:text-[#1cb0f6] rounded-md hover:bg-[#f4faff] transition cursor-pointer"
												title="Edit hypothesis"
											>
												<Pencil class="w-3 h-3" />
											</button>
											<button
												type="button"
												onclick={() => handleDeleteMemory(item.id)}
												class="p-1 text-[#777777] hover:text-[#ff4b4b] rounded-md hover:bg-[#fff0f0] transition cursor-pointer"
												title="Delete hypothesis"
											>
												<Trash2 class="w-3 h-3" />
											</button>
										</div>
									</div>

									<p class="font-semibold text-[#3c3c3c] leading-relaxed">{item.content}</p>
								</div>
							{/each}
						{/if}
					</div>
				</div>
			</div>
		</div>

		<!-- Commission History Section -->
		<div class="bg-white border-2 border-[#c7e8fa] rounded-xl p-6 shadow-sm space-y-5">
			<div class="flex items-center justify-between">
				<div class="flex items-center gap-3">
					<div
						class="w-10 h-10 rounded-xl bg-[#ddf4ff] border-2 border-[#c7e8fa] flex items-center justify-center text-[#1cb0f6]"
					>
						<Briefcase class="w-5 h-5" />
					</div>
					<div>
						<h2 class="text-lg font-black text-[#3c3c3c] tracking-tight">Commission History</h2>
						<p class="text-xs text-[#777777]">Past and active commission orders for this client</p>
					</div>
				</div>

				<span
					class="px-3 py-1 bg-[#f4faff] border border-[#c7e8fa] text-xs font-bold text-[#3c3c3c] rounded-xl"
				>
					{commissions.length} {commissions.length === 1 ? 'order' : 'orders'}
				</span>
			</div>

			{#if commissions.length === 0}
				<div class="bg-[#f4faff] border border-[#c7e8fa] rounded-xl p-8 text-center">
					<Briefcase class="w-10 h-10 text-[#c7e8fa] mx-auto mb-2" />
					<p class="text-xs font-bold text-[#777777]">No commission records for this client yet.</p>
				</div>
			{:else}
				<div class="space-y-3">
					{#each commissions as comm (comm.id)}
						{@const badge = getStatusBadge(comm.status)}
						<div
							class="bg-[#f4faff] border-2 border-[#c7e8fa] rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:border-[#1cb0f6] transition"
						>
							<div class="space-y-1">
								<div class="flex items-center gap-2.5 flex-wrap">
									<h3 class="text-sm font-black text-[#3c3c3c]">{comm.serviceName}</h3>
									<span
										class="px-2 py-0.5 text-xs font-bold rounded-lg border {badge.bg} {badge.border}"
										style="color: {badge.color}"
									>
										{badge.label}
									</span>
									<span class="text-xs font-bold text-[#777777]">
										{comm.externalId ? `#${comm.externalId.replace(/^#/, '')}` : `#VG-${comm.id}`}
									</span>
								</div>

								<div class="flex items-center gap-4 text-xs text-[#777777] flex-wrap">
									<span>
										Amount:
										<strong class="text-[#3c3c3c]">
											${parseFloat(comm.amount || '0').toFixed(2)}
											{comm.currency || 'USD'}
										</strong>
									</span>
									<span class="flex items-center gap-1">
										<Clock class="w-3.5 h-3.5 text-[#1cb0f6]" />
										Delivery:
										<strong class="text-[#3c3c3c]">{formatDate(comm.guaranteedDelivery)}</strong>
									</span>
								</div>
							</div>

							<div class="flex items-center gap-2">
								<a
									href="/commissions"
									class="px-3 py-1.5 bg-white border-2 border-[#c7e8fa] text-[#3c3c3c] rounded-xl text-xs font-bold hover:bg-[#ddf4ff] hover:border-[#1cb0f6] transition"
								>
									View on Board
								</a>
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	{/if}
</div>

<!-- Modal Dialog: Add / Edit Memory Note -->
{#if isMemoryModalOpen}
	<div
		class="fixed inset-0 z-50 bg-[#3c3c3c]/50 backdrop-blur-xs flex items-center justify-center p-4"
	>
		<div
			class="bg-white border-2 border-[#c7e8fa] rounded-2xl p-6 w-full max-w-lg shadow-xl space-y-4 animate-in fade-in zoom-in-95 duration-150"
		>
			<div class="flex items-center justify-between border-b border-[#f4faff] pb-3">
				<div class="flex items-center gap-2">
					<Sparkles class="w-5 h-5 text-[#af71f5]" />
					<h3 class="text-base font-black text-[#3c3c3c]">
						{editingMemoryId !== null ? 'Edit Memory Note' : 'Add Client Memory'}
					</h3>
				</div>
				<button
					type="button"
					onclick={closeMemoryModal}
					class="p-1 text-[#777777] hover:text-[#3c3c3c] rounded-lg hover:bg-[#f4faff] transition cursor-pointer"
				>
					<X class="w-5 h-5" />
				</button>
			</div>

			{#if memoryFormError}
				<div
					class="p-3 bg-[#fff0f0] border border-[#ffcdd2] rounded-xl text-xs font-bold text-[#ff4b4b] flex items-center gap-2"
				>
					<AlertCircle class="w-4 h-4 shrink-0" />
					<span>{memoryFormError}</span>
				</div>
			{/if}

			<div class="space-y-4">
				<!-- Memory Type -->
				<div>
					<label for="mem-type" class="block text-xs font-bold text-[#777777] mb-1.5">
						Epistemic Type
					</label>
					<select
						id="mem-type"
						bind:value={formType}
						class="w-full bg-[#f4faff] border-2 border-[#c7e8fa] rounded-xl px-3 py-2 text-xs font-bold text-[#3c3c3c] focus:outline-hidden focus:border-[#1cb0f6]"
					>
						<option value="fact">FACT (Verified technical spec, link, or rule)</option>
						<option value="preference">PREFERENCE (Scope habit, review order, style)</option>
						<option value="inference">INFERENCE (Tentative hypothesis - never stated as fact)</option>
					</select>
				</div>

				<!-- Category -->
				<div>
					<label for="mem-cat" class="block text-xs font-bold text-[#777777] mb-1.5">
						Scope Category
					</label>
					<select
						id="mem-cat"
						bind:value={formCategory}
						class="w-full bg-[#f4faff] border-2 border-[#c7e8fa] rounded-xl px-3 py-2 text-xs font-bold text-[#3c3c3c] focus:outline-hidden focus:border-[#1cb0f6]"
					>
						<option value="technical">Technical (Software, Cubism, Model Rig params)</option>
						<option value="scope">Scope (Separation cuts, milestones, revisions)</option>
						<option value="assets">Assets (Master PSD link, references, drive folder)</option>
						<option value="communication">Communication (Timezone, language, messaging style)</option>
						<option value="general">General (Notes & metadata)</option>
					</select>
				</div>

				<!-- Content Textarea -->
				<div>
					<label for="mem-content" class="block text-xs font-bold text-[#777777] mb-1.5">
						Memory Content / Note
					</label>
					<textarea
						id="mem-content"
						bind:value={formContent}
						rows="4"
						placeholder="e.g. Uses VTube Studio on iOS tracking. Model was created with Live2D Cubism 5.0."
						class="w-full bg-[#f4faff] border-2 border-[#c7e8fa] rounded-xl p-3 text-xs font-medium text-[#3c3c3c] focus:outline-hidden focus:border-[#1cb0f6] resize-none"
					></textarea>
				</div>
			</div>

			<div class="flex items-center justify-end gap-3 pt-3 border-t border-[#f4faff]">
				<button
					type="button"
					onclick={closeMemoryModal}
					class="px-4 py-2 bg-white border-2 border-[#c7e8fa] text-[#777777] rounded-xl font-bold text-xs hover:bg-[#f4faff] transition cursor-pointer"
				>
					Cancel
				</button>
				<button
					type="button"
					onclick={handleSaveMemory}
					disabled={isSubmittingMemory}
					class="px-4 py-2 bg-[#a5ed6e] text-[#1b4332] border-2 border-[#8ee052] rounded-xl font-black text-xs hover:bg-[#8ee052] transition cursor-pointer shadow-sm active:scale-95 disabled:opacity-50"
				>
					{isSubmittingMemory ? 'Saving...' : editingMemoryId !== null ? 'Save Changes' : 'Add Note'}
				</button>
			</div>
		</div>
	</div>
{/if}
