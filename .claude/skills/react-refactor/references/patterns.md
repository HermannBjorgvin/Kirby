# React Refactoring Patterns Reference (2025–2026)

This is the authoritative pattern catalog for the react-refactor skill. Every smell has a before/after example and a one-line rationale. Patterns are grouped by category.

## Table of Contents

1. [useEffect Anti-Patterns](#1-useeffect-anti-patterns)
2. [State Management](#2-state-management)
3. [Component Architecture](#3-component-architecture)
4. [TypeScript](#4-typescript)
5. [React 19 Upgrades](#5-react-19-upgrades)
6. [Performance](#6-performance)
7. [Project Structure](#7-project-structure)
8. [Triage Checklist](#8-triage-checklist)

---

## 1. useEffect Anti-Patterns

useEffect is an escape hatch for synchronizing with external systems. It is NOT a lifecycle method, NOT an event handler, and NOT a place to derive state. The majority of useEffect calls in typical codebases can be removed entirely.

### 1.1 Derived state stored in useState + useEffect

This is the single most common React anti-pattern. If a value can be computed from existing state or props, compute it during render.

```tsx
// ❌ BEFORE — extra state, extra render, potential staleness
const [fullName, setFullName] = useState('');
useEffect(() => {
  setFullName(`${firstName} ${lastName}`);
}, [firstName, lastName]);

// ✅ AFTER — computed during render, always in sync
const fullName = `${firstName} ${lastName}`;
```

```tsx
// ❌ BEFORE — filtering in useEffect
const [filtered, setFiltered] = useState<Item[]>([]);
useEffect(() => {
  setFiltered(items.filter((i) => i.category === category));
}, [items, category]);

// ✅ AFTER — derived inline (add useMemo only if items is 10k+)
const filtered = items.filter((i) => i.category === category);
```

**When to add useMemo:** Only if the computation is genuinely expensive (large arrays, complex transformations) AND you've measured the cost with React DevTools Profiler. Don't guess — profile.

### 1.2 Event handling in useEffect

Logic that runs in response to a user action belongs in the event handler, not an effect.

```tsx
// ❌ BEFORE — effect reacting to state change caused by user action
const [submitted, setSubmitted] = useState(false);
useEffect(() => {
  if (submitted) {
    sendAnalytics('form_submit');
    showToast('Saved!');
  }
}, [submitted]);

function handleSubmit() {
  saveData(formData);
  setSubmitted(true);
}

// ✅ AFTER — logic lives in the event handler where it belongs
function handleSubmit() {
  saveData(formData);
  sendAnalytics('form_submit');
  showToast('Saved!');
}
```

### 1.3 Notifying parent of state changes

```tsx
// ❌ BEFORE — syncing child state to parent via effect
function Toggle({ onChange }: { onChange: (on: boolean) => void }) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    onChange(on);
  }, [on, onChange]);

  return <button onClick={() => setOn((prev) => !prev)}>Toggle</button>;
}

// ✅ AFTER — notify in the event handler
function Toggle({ onChange }: { onChange: (on: boolean) => void }) {
  const [on, setOn] = useState(false);

  function handleToggle() {
    const next = !on;
    setOn(next);
    onChange(next);
  }

  return <button onClick={handleToggle}>Toggle</button>;
}
```

### 1.4 Resetting state when props change

```tsx
// ❌ BEFORE — resetting state with useEffect
function ChatPanel({ contactId }: { contactId: string }) {
  const [draft, setDraft] = useState('');
  useEffect(() => {
    setDraft('');
  }, [contactId]);
  // ...
}

// ✅ AFTER — use key to reset component identity
// Parent:
<ChatPanel key={contactId} contactId={contactId} />;

// ChatPanel just initializes normally:
function ChatPanel({ contactId }: { contactId: string }) {
  const [draft, setDraft] = useState('');
  // draft starts as '' for each new contactId automatically
}
```

### 1.5 Data fetching in useEffect

```tsx
// ❌ BEFORE — manual fetch with loading/error state management
const [data, setData] = useState<User | null>(null);
const [loading, setLoading] = useState(true);
const [error, setError] = useState<Error | null>(null);

useEffect(() => {
  let cancelled = false;
  setLoading(true);
  fetchUser(id)
    .then((user) => {
      if (!cancelled) setData(user);
    })
    .catch((err) => {
      if (!cancelled) setError(err);
    })
    .finally(() => {
      if (!cancelled) setLoading(false);
    });
  return () => {
    cancelled = true;
  };
}, [id]);

// ✅ AFTER — TanStack Query handles caching, dedup, refetch, errors
const { data, isLoading, error } = useQuery({
  queryKey: ['user', id],
  queryFn: () => fetchUser(id),
});
```

### 1.6 Subscribing to external stores

```tsx
// ❌ BEFORE — manual subscribe/unsubscribe
const [isOnline, setIsOnline] = useState(true);
useEffect(() => {
  const handleChange = () => setIsOnline(navigator.onLine);
  window.addEventListener('online', handleChange);
  window.addEventListener('offline', handleChange);
  return () => {
    window.removeEventListener('online', handleChange);
    window.removeEventListener('offline', handleChange);
  };
}, []);

// ✅ AFTER — useSyncExternalStore
function subscribe(callback: () => void) {
  window.addEventListener('online', callback);
  window.addEventListener('offline', callback);
  return () => {
    window.removeEventListener('online', callback);
    window.removeEventListener('offline', callback);
  };
}

const isOnline = useSyncExternalStore(
  subscribe,
  () => navigator.onLine,
  () => true // server snapshot
);
```

### 1.7 App initialization in useEffect

```tsx
// ❌ BEFORE — runs twice in Strict Mode, causes double-init bugs
useEffect(() => {
  analytics.init();
  loadConfig();
}, []);

// ✅ AFTER — module-level initialization
if (typeof window !== 'undefined') {
  analytics.init();
  loadConfig();
}
```

### 1.8 Legitimate useEffect uses

Keep useEffect for these — they are correct:

- WebSocket connection setup/teardown
- Third-party DOM library integration (D3, map widgets, editors)
- Browser API synchronization (Intersection Observer, Resize Observer)
- Focus management after render
- Imperative animations tied to mount/unmount
- Logging when a component is _displayed_ (not user-triggered)

Rules for legitimate effects:

- One effect per concern
- Always return a cleanup function for subscriptions/timers/listeners
- Never lie about dependencies — follow exhaustive-deps
- Extract into a custom hook with a declarative name: `useDocumentTitle(title)`, `useWebSocket(url)`

---

## 2. State Management

### 2.1 Decision hierarchy

Always start at the top. Move down only when the simpler option genuinely doesn't work.

| Level | Tool               | Use when                                                                   |
| ----- | ------------------ | -------------------------------------------------------------------------- |
| 1     | Derive it          | Value computable from existing state/props                                 |
| 2     | `useState`         | Local UI state: toggles, inputs, tabs                                      |
| 3     | `useReducer`       | 3+ related states with complex transitions                                 |
| 4     | Lift state up      | Siblings need the same state (2–3 levels of prop passing is fine)          |
| 5     | Composition        | `children` prop avoids drilling through intermediate components            |
| 6     | URL state (`nuqs`) | Search, filters, pagination, sort, active tab — anything shareable via URL |
| 7     | React Context      | Low-frequency app-wide: theme, locale, current user                        |
| 8     | Zustand            | Shared global client state that changes frequently                         |
| 9     | TanStack Query     | ALL server/async data                                                      |

### 2.2 Server state belongs in TanStack Query, never in client stores

```tsx
// ❌ BEFORE — server data in Zustand/Redux/Context
const useStore = create((set) => ({
  users: [],
  fetchUsers: async () => {
    const users = await api.getUsers();
    set({ users });
  },
}));

// ✅ AFTER — TanStack Query manages the full lifecycle
const { data: users } = useQuery({
  queryKey: ['users'],
  queryFn: api.getUsers,
});
```

TanStack Query provides: caching, background refetching, deduplication, stale-while-revalidate, error retry, optimistic updates, pagination, and infinite scroll — all for free.

### 2.3 Context is for low-frequency data only

```tsx
// ❌ BAD — frequently updating value in Context re-renders ALL consumers
const AppContext = createContext({
  user: null,
  theme: 'light',
  notifications: [],
  cartCount: 0,
});

// ✅ GOOD — split into separate contexts by update frequency
const AuthContext = createContext<AuthValue>(/* ... */); // rarely changes
const ThemeContext = createContext<ThemeValue>(/* ... */); // rarely changes
const CartContext = createContext<CartValue>(/* ... */); // changes often → use Zustand instead
```

### 2.4 Multiple related useState → useReducer

```tsx
// ❌ BEFORE — scattered related state
const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>(
  'idle'
);
const [data, setData] = useState<Data | null>(null);
const [error, setError] = useState<Error | null>(null);

// ✅ AFTER — useReducer with discriminated union
type State =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: Data }
  | { status: 'error'; error: Error };

type Action =
  | { type: 'FETCH' }
  | { type: 'SUCCESS'; data: Data }
  | { type: 'ERROR'; error: Error };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'FETCH':
      return { status: 'loading' };
    case 'SUCCESS':
      return { status: 'success', data: action.data };
    case 'ERROR':
      return { status: 'error', error: action.error };
  }
}
```

### 2.5 URL state for shareable UI state

```tsx
// ❌ BEFORE — search/filter state lost on page refresh or share
const [search, setSearch] = useState('');
const [page, setPage] = useState(1);
const [sort, setSort] = useState('date');

// ✅ AFTER — URL state with nuqs (survives refresh, shareable)
import { useQueryState, parseAsInteger, parseAsStringLiteral } from 'nuqs';

const [search, setSearch] = useQueryState('q', {
  defaultValue: '',
  throttleMs: 300,
});
const [page, setPage] = useQueryState('page', parseAsInteger.withDefault(1));
const [sort, setSort] = useQueryState(
  'sort',
  parseAsStringLiteral(['date', 'name', 'price']).withDefault('date')
);
```

Use URL state for: search queries, pagination, sort order, active filters, view modes, active tabs (when the user should be able to share the link).

### 2.6 Zustand pattern

```tsx
// ✅ Clean Zustand store — typed, minimal, actions colocated
import { create } from 'zustand';

interface SidebarStore {
  isOpen: boolean;
  toggle: () => void;
  close: () => void;
}

export const useSidebarStore = create<SidebarStore>((set) => ({
  isOpen: false,
  toggle: () => set((s) => ({ isOpen: !s.isOpen })),
  close: () => set({ isOpen: false }),
}));

// Use selectors to avoid unnecessary re-renders
const isOpen = useSidebarStore((s) => s.isOpen);
```

---

## 3. Component Architecture

### 3.1 Component defined inside another component

This is the worst performance bug in React. The inner component is re-created on every render of the parent, which remounts it (destroying all state and DOM).

```tsx
// ❌ CRITICAL — inner component remounts every render
function UserList({ users }: { users: User[] }) {
  // This creates a NEW component type every render
  const UserCard = ({ user }: { user: User }) => <div>{user.name}</div>;

  return users.map((u) => <UserCard key={u.id} user={u} />);
}

// ✅ AFTER — component defined outside
function UserCard({ user }: { user: User }) {
  return <div>{user.name}</div>;
}

function UserList({ users }: { users: User[] }) {
  return users.map((u) => <UserCard key={u.id} user={u} />);
}
```

### 3.2 Composition over prop explosion

```tsx
// ❌ BEFORE — too many props, inflexible
<Card
  title="Settings"
  subtitle="Manage preferences"
  headerIcon={<GearIcon />}
  footer={<SaveButton />}
  onHeaderClick={handleClick}
  showDivider
  isCompact
/>

// ✅ AFTER — composition via children
<Card compact>
  <Card.Header onClick={handleClick}>
    <GearIcon /> Settings
  </Card.Header>
  <Card.Body>Manage preferences</Card.Body>
  <Card.Footer><SaveButton /></Card.Footer>
</Card>
```

### 3.3 Compound components

```tsx
// ✅ Compound component pattern — shared state via context
const SelectContext = createContext<SelectContextValue | undefined>(undefined);

function useSelectContext() {
  const ctx = useContext(SelectContext);
  if (!ctx)
    throw new Error('Select sub-components must be used within <Select>');
  return ctx;
}

function Select({ children, value, onChange }: SelectProps) {
  const contextValue = useMemo(() => ({ value, onChange }), [value, onChange]);
  return (
    <SelectContext.Provider value={contextValue}>
      <div role="listbox">{children}</div>
    </SelectContext.Provider>
  );
}

Select.Option = function Option({ value, children }: OptionProps) {
  const { value: selected, onChange } = useSelectContext();
  return (
    <div
      role="option"
      aria-selected={value === selected}
      onClick={() => onChange(value)}
    >
      {children}
    </div>
  );
};
```

### 3.4 Prop drilling fix — composition pattern

```tsx
// ❌ BEFORE — drilling theme through intermediate components
function App() {
  return (
    <Layout theme={theme}>
      <Sidebar theme={theme}>
        <Nav theme={theme} />
      </Sidebar>
    </Layout>
  );
}

// ✅ AFTER — composition avoids drilling entirely
function App() {
  return (
    <Layout>
      <Sidebar>
        <Nav className={theme === 'dark' ? 'nav-dark' : 'nav-light'} />
      </Sidebar>
    </Layout>
  );
}
// Layout and Sidebar just render {children} — they don't need theme at all
```

### 3.5 God component → extract

```tsx
// ❌ BEFORE — 400-line component doing everything
function Dashboard() {
  // 20 useState calls
  // 5 useEffect calls
  // 3 fetch calls
  // Complex render with nested ternaries
}

// ✅ AFTER — extracted into focused pieces
function Dashboard() {
  return (
    <DashboardLayout>
      <MetricsPanel />
      <RecentActivity />
      <QuickActions />
    </DashboardLayout>
  );
}

// Each sub-component owns its own state and data fetching
function MetricsPanel() {
  const { data } = useQuery({ queryKey: ['metrics'], queryFn: fetchMetrics });
  return /* focused render */;
}
```

### 3.6 Nested ternary → early returns

```tsx
// ❌ BEFORE
return isLoading ? (
  <Spinner />
) : hasError ? (
  <ErrorBanner error={error} />
) : data.length === 0 ? (
  <EmptyState />
) : (
  <DataTable data={data} />
);

// ✅ AFTER — early returns
if (isLoading) return <Spinner />;
if (hasError) return <ErrorBanner error={error} />;
if (data.length === 0) return <EmptyState />;
return <DataTable data={data} />;
```

### 3.7 Copying props into state

```tsx
// ❌ BEFORE — stale state diverges from props
function Greeting({ name }: { name: string }) {
  const [displayName, setDisplayName] = useState(name);
  return <h1>Hello, {displayName}</h1>;
}

// ✅ AFTER — use the prop directly
function Greeting({ name }: { name: string }) {
  return <h1>Hello, {name}</h1>;
}
```

Exception: seed/default values where the component intentionally takes ownership:

```tsx
// ✅ OK — explicitly an initial value, component owns subsequent changes
function EditableField({ initialValue }: { initialValue: string }) {
  const [value, setValue] = useState(initialValue);
  return <input value={value} onChange={(e) => setValue(e.target.value)} />;
}
```

### 3.8 Key prop for identity reset

```tsx
// ✅ Use key to force React to mount a fresh component instance
<OrderForm key={orderId} orderId={orderId} />
// When orderId changes, React unmounts the old OrderForm and mounts a new one
// All internal state (form fields, validation) resets automatically
```

### 3.9 Custom hooks — when to extract

Extract a custom hook when:

- Logic is reused across 2+ components
- A component has 3+ related state/effect calls
- The hook improves readability (gives the logic a name)

Do NOT create a hook when:

- The function never calls another hook — make it a plain utility function
- You're wrapping a single useState for "organization" — that adds indirection without value
- You'd name it `useMount` — this doesn't fit React's model

```tsx
// ✅ Good custom hook — reusable, descriptive, calls hooks
function useDocumentTitle(title: string) {
  useEffect(() => {
    document.title = title;
    return () => {
      document.title = 'App';
    };
  }, [title]);
}

// ❌ Bad "hook" — doesn't call any hooks, should be a plain function
function useFormatDate(date: Date) {
  return new Intl.DateTimeFormat('en-US').format(date);
}
// ✅ Just make it a function
function formatDate(date: Date) {
  return new Intl.DateTimeFormat('en-US').format(date);
}
```

---

## 4. TypeScript

### 4.1 Interface for props (not type intersection)

```tsx
// ✅ PREFERRED — interface extends is faster for the TS compiler
interface ButtonProps extends React.ComponentProps<'button'> {
  variant: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
}

// ❌ AVOID at scale — type intersection is slower
type ButtonProps = React.ComponentProps<'button'> & {
  variant: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
};
```

### 4.2 Discriminated unions for variant props

```tsx
// ❌ BEFORE — ambiguous optional props
interface ModalProps {
  type: 'confirm' | 'alert' | 'prompt';
  onConfirm?: () => void; // required for confirm, ignored for alert
  defaultValue?: string; // only for prompt
  confirmLabel?: string; // only for confirm
}

// ✅ AFTER — impossible states are unrepresentable
type ModalProps =
  | { type: 'alert'; message: string }
  | {
      type: 'confirm';
      message: string;
      onConfirm: () => void;
      confirmLabel?: string;
    }
  | {
      type: 'prompt';
      message: string;
      onSubmit: (value: string) => void;
      defaultValue?: string;
    };

function Modal(props: ModalProps) {
  switch (props.type) {
    case 'alert':
      return /* only has message */;
    case 'confirm':
      return /* has onConfirm and confirmLabel */;
    case 'prompt':
      return /* has onSubmit and defaultValue */;
  }
}
```

### 4.3 Eliminate `any`

```tsx
// ❌ BEFORE
function processResponse(data: any) {
  return data.results.map((item: any) => item.name);
}

// ✅ AFTER — define types, validate at boundaries
interface ApiResponse {
  results: Array<{ id: number; name: string }>;
}

function processResponse(data: ApiResponse) {
  return data.results.map((item) => item.name);
}

// ✅ For truly unknown data (API boundaries), use Zod
import { z } from 'zod';
const ResponseSchema = z.object({
  results: z.array(z.object({ id: z.number(), name: z.string() })),
});
type ApiResponse = z.infer<typeof ResponseSchema>;

function processResponse(raw: unknown): string[] {
  const data = ResponseSchema.parse(raw);
  return data.results.map((item) => item.name);
}
```

### 4.4 Generic components

```tsx
// ✅ Generic list component — TItem inferred from usage
function SelectList<TItem>({
  items,
  selected,
  onSelect,
  getKey,
  renderItem,
}: {
  items: TItem[];
  selected: TItem | null;
  onSelect: (item: TItem) => void;
  getKey: (item: TItem) => string;
  renderItem: (item: TItem) => ReactNode;
}) {
  return (
    <ul>
      {items.map((item) => (
        <li key={getKey(item)} onClick={() => onSelect(item)}>
          {renderItem(item)}
        </li>
      ))}
    </ul>
  );
}

// Usage — TItem inferred as User
<SelectList
  items={users}
  selected={currentUser}
  onSelect={setCurrentUser}
  getKey={(u) => u.id}
  renderItem={(u) => <span>{u.name}</span>}
/>;
```

### 4.5 Guarded context hooks

```tsx
// ✅ Always create a guarded hook — eliminates `| undefined` from consumer code
const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (ctx === undefined) {
    throw new Error('useAuth must be used within an <AuthProvider>');
  }
  return ctx;
}
```

### 4.6 Tuple returns with `as const`

```tsx
// ❌ BEFORE — return type is (boolean | () => void)[]
function useToggle(initial = false) {
  const [on, setOn] = useState(initial);
  const toggle = useCallback(() => setOn((v) => !v), []);
  return [on, toggle];
}

// ✅ AFTER — return type is readonly [boolean, () => void]
function useToggle(initial = false) {
  const [on, setOn] = useState(initial);
  const toggle = useCallback(() => setOn((v) => !v), []);
  return [on, toggle] as const;
}
```

### 4.7 React 19 refs — no more forwardRef

```tsx
// ❌ BEFORE (React 18) — forwardRef wrapper
const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, ...props }, ref) => (
    <label>
      {label}
      <input ref={ref} {...props} />
    </label>
  )
);

// ✅ AFTER (React 19) — ref is a regular prop
interface InputProps extends React.ComponentProps<'input'> {
  label: string;
}

function Input({ label, ref, ...props }: InputProps) {
  return (
    <label>
      {label}
      <input ref={ref} {...props} />
    </label>
  );
}
```

### 4.8 Children typing

```tsx
// ✅ Use ReactNode — accepts anything React can render
interface CardProps {
  children: React.ReactNode;
  title: string;
}

// ✅ PropsWithChildren shorthand for wrapper components
type LayoutProps = React.PropsWithChildren<{ sidebar?: React.ReactNode }>;

// ❌ Don't use JSX.Element — too restrictive (rejects strings, arrays, null)
```

---

## 5. React 19 Upgrades

### 5.1 Form handling with useActionState

```tsx
// ❌ BEFORE — manual loading state
function ContactForm() {
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setIsPending(true);
    setError(null);
    try {
      await submitContact(new FormData(e.currentTarget as HTMLFormElement));
    } catch (err) {
      setError(err.message);
    } finally {
      setIsPending(false);
    }
  }

  return <form onSubmit={handleSubmit}>...</form>;
}

// ✅ AFTER — useActionState manages everything
function ContactForm() {
  const [state, formAction, isPending] = useActionState(submitContactAction, {
    error: null,
  });

  return (
    <form action={formAction}>
      {state.error && <p>{state.error}</p>}
      <input name="email" required />
      <SubmitButton />
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending}>
      {pending ? 'Sending...' : 'Send'}
    </button>
  );
}
```

### 5.2 Optimistic updates with useOptimistic

```tsx
// ✅ Optimistic UI for instant feedback
function TodoList({ todos }: { todos: Todo[] }) {
  const [optimisticTodos, addOptimistic] = useOptimistic(
    todos,
    (current, newTodo: Todo) => [...current, newTodo]
  );

  async function handleAdd(formData: FormData) {
    const text = formData.get('text') as string;
    const tempTodo = { id: crypto.randomUUID(), text, completed: false };
    addOptimistic(tempTodo);
    await addTodoAction(text); // server action
  }

  return (
    <form action={handleAdd}>
      <input name="text" />
      <button type="submit">Add</button>
      <ul>
        {optimisticTodos.map((t) => (
          <li key={t.id}>{t.text}</li>
        ))}
      </ul>
    </form>
  );
}
```

### 5.3 use() for reading promises and context

```tsx
// ✅ use() can be called conditionally (unlike other hooks)
function UserProfile({ userPromise }: { userPromise: Promise<User> }) {
  const user = use(userPromise); // suspends until resolved
  return <h1>{user.name}</h1>;
}

// ✅ use() for conditional context reading
function Panel({ showTheme }: { showTheme: boolean }) {
  if (showTheme) {
    const theme = use(ThemeContext);
    return <div className={theme}>Themed</div>;
  }
  return <div>Default</div>;
}
```

### 5.4 Remove defaultProps

```tsx
// ❌ BEFORE — deprecated in React 19 for function components
function Button({ size = 'md' }: ButtonProps) {
  /* ... */
}
Button.defaultProps = { size: 'md' };

// ✅ AFTER — ES6 default parameters (already the standard)
function Button({ size = 'md' }: ButtonProps) {
  /* ... */
}
// Just remove the defaultProps line
```

---

## 6. Performance

### 6.1 React Compiler era — stop manual memoization

```tsx
// ❌ BEFORE — manual memoization everywhere "just in case"
const MemoizedChild = React.memo(Child);
const handleClick = useCallback(() => doThing(id), [id]);
const processed = useMemo(() => transform(data), [data]);

return <MemoizedChild onClick={handleClick} data={processed} />;

// ✅ AFTER — write plain code, compiler handles optimization
return <Child onClick={() => doThing(id)} data={transform(data)} />;
```

Remove manual useMemo, useCallback, and React.memo UNLESS:

- React DevTools Profiler shows a measured bottleneck
- A third-party library requires referential stability (e.g., some chart libraries)
- The component is NOT yet covered by the React Compiler

### 6.2 State colocation — the #1 performance technique

```tsx
// ❌ BEFORE — input state in parent re-renders entire page
function Page() {
  const [search, setSearch] = useState('');
  return (
    <div>
      <input value={search} onChange={(e) => setSearch(e.target.value)} />
      <ExpensiveList /> {/* re-renders on every keystroke */}
      <ExpensiveChart /> {/* re-renders on every keystroke */}
    </div>
  );
}

// ✅ AFTER — state colocated in its own component
function SearchInput({ onSearch }: { onSearch: (q: string) => void }) {
  const [search, setSearch] = useState('');
  return (
    <input
      value={search}
      onChange={(e) => {
        setSearch(e.target.value);
        onSearch(e.target.value);
      }}
    />
  );
}

function Page() {
  const handleSearch = (q: string) => {
    /* debounced fetch */
  };
  return (
    <div>
      <SearchInput onSearch={handleSearch} />
      <ExpensiveList /> {/* no longer re-renders on keystrokes */}
      <ExpensiveChart />
    </div>
  );
}
```

### 6.3 Children pattern — free performance

```tsx
// ✅ Children don't re-render when parent state changes
function AnimatedWrapper({ children }: { children: ReactNode }) {
  const [isVisible, setIsVisible] = useState(false);
  // children prop doesn't change when isVisible changes
  // so React skips re-rendering children
  return (
    <div className={isVisible ? 'visible' : 'hidden'}>
      <button onClick={() => setIsVisible((v) => !v)}>Toggle</button>
      {children}
    </div>
  );
}
```

### 6.4 Virtualization for large lists

```tsx
// ✅ Use react-window or react-virtuoso for 1000+ items
import { FixedSizeList } from 'react-window';

function VirtualList({ items }: { items: Item[] }) {
  return (
    <FixedSizeList
      height={600}
      itemCount={items.length}
      itemSize={50}
      width="100%"
    >
      {({ index, style }) => <div style={style}>{items[index].name}</div>}
    </FixedSizeList>
  );
}
```

### 6.5 Route-level code splitting

```tsx
// ✅ Lazy load route-level components
const Settings = lazy(() => import('./features/settings/SettingsPage'));
const Dashboard = lazy(() => import('./features/dashboard/DashboardPage'));

function AppRoutes() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Routes>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/settings" element={<Settings />} />
      </Routes>
    </Suspense>
  );
}
```

---

## 7. Project Structure

### 7.1 Feature-first folder structure

```
src/
├── app/                       # App shell, routing, providers
│   ├── routes/
│   ├── providers.tsx
│   └── router.tsx
├── features/                  # Feature modules — heart of the app
│   ├── auth/
│   │   ├── api/               # API calls + TanStack Query hooks
│   │   ├── components/
│   │   ├── hooks/
│   │   ├── stores/            # Zustand stores (if needed)
│   │   └── types/
│   ├── dashboard/
│   └── settings/
├── components/                # Shared UI only (Button, Modal, Input)
│   ├── ui/
│   └── layouts/
├── hooks/                     # Shared hooks (useMediaQuery, useDebounce)
├── lib/                       # Library config (axios, dayjs, query-client)
├── types/                     # Shared types
└── utils/                     # Shared utilities
```

Rules:

- **Features never import from other features.** Compose at the route level.
- **Unidirectional deps:** `shared → features → app`.
- **Colocate tests:** `Button.tsx` + `Button.test.tsx` in the same folder.
- **Add subfolders only as needed.** Not every feature needs api/, hooks/, stores/.

### 7.2 No barrel files for application code

```tsx
// ❌ DON'T — barrel files cause slow builds, circular imports, broken HMR
// features/auth/index.ts
export { LoginForm } from './components/LoginForm';
export { useAuth } from './hooks/useAuth';

// ✅ DO — import directly
import { LoginForm } from '@/features/auth/components/LoginForm';
import { useAuth } from '@/features/auth/hooks/useAuth';
```

Barrel files are only acceptable for: published npm packages, design system library entry points.

### 7.3 Naming conventions

| Entity         | Convention                   | Example            |
| -------------- | ---------------------------- | ------------------ |
| Components     | PascalCase                   | `UserProfile.tsx`  |
| Hooks          | camelCase, `use` prefix      | `useAuth.ts`       |
| Utilities      | camelCase                    | `formatDate.ts`    |
| Types          | PascalCase, `.types.ts`      | `User.types.ts`    |
| Constants      | SCREAMING_SNAKE              | `API_ENDPOINTS.ts` |
| Folders        | kebab-case                   | `user-profile/`    |
| Zustand stores | `use` + PascalCase + `Store` | `useAuthStore.ts`  |

---

## 8. Triage Checklist

Use this checklist when auditing a codebase. Check each item. Mark findings by severity.

### Critical — fix immediately

- [ ] Components defined inside other components
- [ ] Derived state in useState + useEffect
- [ ] Missing cleanup in useEffect (memory leaks)
- [ ] Server data stored in Redux/Zustand/Context instead of a query library
- [ ] `any` types in function signatures or state

### High — fix soon

- [ ] Prop drilling through 4+ component levels
- [ ] God components (300+ lines, multiple concerns)
- [ ] Multiple boolean flags that should be a union state
- [ ] useEffect used for event handling logic
- [ ] Missing error boundaries

### Medium — fix during maintenance

- [ ] Manual useMemo/useCallback that could be removed (React Compiler)
- [ ] Nested ternary chains in JSX
- [ ] Props copied into state (no `initialValue` naming)
- [ ] Custom hooks that don't call other hooks (should be plain functions)
- [ ] Barrel files in application code

### Low — address when touching the file

- [ ] Missing discriminated unions for variant-based props
- [ ] `type` used where `interface extends` would be better
- [ ] forwardRef that could be removed (React 19)
- [ ] defaultProps that should be ES6 defaults
- [ ] JSX.Element used instead of ReactNode for children
