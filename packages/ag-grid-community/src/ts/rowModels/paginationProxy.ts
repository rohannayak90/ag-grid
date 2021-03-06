import { BeanStub } from "../context/beanStub";
import { IRowModel, RowBounds } from "../interfaces/iRowModel";
import { EventService } from "../eventService";
import { Events, ModelUpdatedEvent, PaginationChangedEvent } from "../events";
import { RowNode } from "../entities/rowNode";
import { Autowired, Bean, PostConstruct } from "../context/context";
import { GridOptionsWrapper } from "../gridOptionsWrapper";
import { GridPanel } from "../gridPanel/gridPanel";
import { ScrollVisibleService } from "../gridPanel/scrollVisibleService";
import { SelectionController } from "../selectionController";
import { ColumnApi } from "../columnController/columnApi";
import { GridApi } from "../gridApi";
import { _ } from "../utils";

@Bean('paginationAutoPageSizeService')
export class PaginationAutoPageSizeService extends BeanStub {

    @Autowired('eventService') private eventService: EventService;
    @Autowired('gridOptionsWrapper') private gridOptionsWrapper: GridOptionsWrapper;
    @Autowired('scrollVisibleService') private scrollVisibleService: ScrollVisibleService;

    private gridPanel: GridPanel;

    public registerGridComp(gridPanel: GridPanel): void {
        this.gridPanel = gridPanel;

        this.addDestroyableEventListener(this.eventService, Events.EVENT_BODY_HEIGHT_CHANGED, this.onBodyHeightChanged.bind(this));
        this.addDestroyableEventListener(this.eventService, Events.EVENT_SCROLL_VISIBILITY_CHANGED, this.onScrollVisibilityChanged.bind(this));
        this.checkPageSize();
    }

    private notActive(): boolean {
        return !this.gridOptionsWrapper.isPaginationAutoPageSize();
    }

    private onScrollVisibilityChanged(): void {
        this.checkPageSize();
    }

    private onBodyHeightChanged(): void {
        this.checkPageSize();
    }

    private checkPageSize(): void {
        if (this.notActive()) {
            return;
        }

        const rowHeight = this.gridOptionsWrapper.getRowHeightAsNumber();
        let bodyHeight = this.gridPanel.getBodyHeight();

        if (this.scrollVisibleService.isHorizontalScrollShowing()) {
            bodyHeight = bodyHeight - this.gridOptionsWrapper.getScrollbarWidth();
        }

        if (bodyHeight > 0) {
            const newPageSize = Math.floor(bodyHeight / rowHeight);
            this.gridOptionsWrapper.setProperty('paginationPageSize', newPageSize);
        }
    }
}

@Bean('paginationProxy')
export class PaginationProxy extends BeanStub implements IRowModel {

    @Autowired('rowModel') private rowModel: IRowModel;
    @Autowired('eventService') private eventService: EventService;
    @Autowired('gridOptionsWrapper') private gridOptionsWrapper: GridOptionsWrapper;
    @Autowired('selectionController') private selectionController: SelectionController;
    @Autowired('columnApi') private columnApi: ColumnApi;
    @Autowired('gridApi') private gridApi: GridApi;

    private active: boolean;

    private pageSize: number;

    private totalPages: number;
    private currentPage = 0;

    private topRowIndex = 0;
    private bottomRowIndex = 0;
    private pixelOffset = 0;
    private topRowBounds: RowBounds;
    private bottomRowBounds: RowBounds;

    @PostConstruct
    private postConstruct() {
        this.active = this.gridOptionsWrapper.isPagination();

        this.addDestroyableEventListener(this.eventService, Events.EVENT_MODEL_UPDATED, this.onModelUpdated.bind(this));

        this.addDestroyableEventListener(this.gridOptionsWrapper, 'paginationPageSize', this.onModelUpdated.bind(this));

        this.onModelUpdated();
    }

    public ensureRowHeightsValid(startPixel: number, endPixel: number, startLimitIndex: number, endLimitIndex: number): boolean {
        const res = this.rowModel.ensureRowHeightsValid(startPixel, endPixel, this.getPageFirstRow(), this.getPageLastRow());
        if (res) {
            this.setIndexesAndBounds();
        }
        return res;
    }

    public isLastRowFound(): boolean {
        return this.rowModel.isLastRowFound();
    }

    private onModelUpdated(modelUpdatedEvent?: ModelUpdatedEvent): void {
        this.setIndexesAndBounds();
        const paginationChangedEvent: PaginationChangedEvent = {
            type: Events.EVENT_PAGINATION_CHANGED,
            animate: modelUpdatedEvent ? modelUpdatedEvent.animate : false,
            newData: modelUpdatedEvent ? modelUpdatedEvent.newData : false,
            newPage: modelUpdatedEvent ? modelUpdatedEvent.newPage : false,
            keepRenderedRows: modelUpdatedEvent ? modelUpdatedEvent.keepRenderedRows : false,
            api: this.gridApi,
            columnApi: this.columnApi
        };
        this.eventService.dispatchEvent(paginationChangedEvent);
    }

    public goToPage(page: number): void {
        if (!this.active) {
            return;
        }
        if (this.currentPage === page) {
            return;
        }
        this.currentPage = page;
        const event: ModelUpdatedEvent = {
            type: Events.EVENT_MODEL_UPDATED,
            animate: false,
            keepRenderedRows: false,
            newData: false,
            newPage: true,
            api: this.gridApi,
            columnApi: this.columnApi
        };
        this.onModelUpdated(event);
    }

    public getPixelOffset(): number {
        return this.pixelOffset;
    }

    public getRow(index: number): RowNode | null {
        return this.rowModel.getRow(index);
    }

    public getRowNode(id: string): RowNode | null {
        return this.rowModel.getRowNode(id);
    }

    public getRowIndexAtPixel(pixel: number): number {
        return this.rowModel.getRowIndexAtPixel(pixel);
    }

    public getCurrentPageHeight(): number {
        if (_.missing(this.topRowBounds) || _.missing(this.bottomRowBounds)) {
            return 0;
        }
        return this.bottomRowBounds.rowTop + this.bottomRowBounds.rowHeight - this.topRowBounds.rowTop;
    }

    public isRowPresent(rowNode: RowNode): boolean {
        if (!this.rowModel.isRowPresent(rowNode)) {
            return false;
        }
        const nodeIsInPage = rowNode.rowIndex >= this.topRowIndex && rowNode.rowIndex <= this.bottomRowIndex;
        return nodeIsInPage;
    }

    public isEmpty(): boolean {
        return this.rowModel.isEmpty();
    }

    public isRowsToRender(): boolean {
        return this.rowModel.isRowsToRender();
    }

    public getNodesInRangeForSelection(firstInRange: RowNode, lastInRange: RowNode): RowNode[] {
        return this.rowModel.getNodesInRangeForSelection(firstInRange, lastInRange);
    }

    public forEachNode(callback: (rowNode: RowNode, index: number) => void): void {
        return this.rowModel.forEachNode(callback);
    }

    public getType(): string {
        return this.rowModel.getType();
    }

    public getRowBounds(index: number): { rowTop: number, rowHeight: number } {
        return this.rowModel.getRowBounds(index);
    }

    public getPageFirstRow(): number {
        return this.pageSize * this.currentPage;
    }

    public getPageLastRow(): number {
        const totalLastRow = (this.pageSize * (this.currentPage + 1)) - 1;
        const pageLastRow = this.rowModel.getPageLastRow();

        if (pageLastRow > totalLastRow) {
            return totalLastRow;
        } else {
            return pageLastRow;
        }
    }

    public getRowCount(): number {
        return this.rowModel.getRowCount();
    }

    public goToPageWithIndex(index: any): void {
        if (!this.active) {
            return;
        }

        const pageNumber = Math.floor(index / this.pageSize);
        this.goToPage(pageNumber);
    }

    public getTotalRowCount(): number {
        return this.rowModel.getPageLastRow() + 1;
    }

    public isLastPageFound(): boolean {
        return this.rowModel.isLastRowFound();
    }

    public getCurrentPage(): number {
        return this.currentPage;
    }

    public goToNextPage(): void {
        this.goToPage(this.currentPage + 1);
    }

    public goToPreviousPage(): void {
        this.goToPage(this.currentPage - 1);
    }

    public goToFirstPage(): void {
        this.goToPage(0);
    }

    public goToLastPage(): void {
        const rowCount = this.rowModel.getPageLastRow() + 1;
        const lastPage = Math.floor(rowCount / this.pageSize);
        this.goToPage(lastPage);
    }

    public getPageSize(): number {
        return this.pageSize;
    }

    public getTotalPages(): number {
        return this.totalPages;
    }

    private setPageSize(): void {
        // show put this into super class
        this.pageSize = this.gridOptionsWrapper.getPaginationPageSize();
        if (!(this.pageSize >= 1)) {
            this.pageSize = 100;
        }
    }

    private setIndexesAndBounds(): void {

        if (this.active) {
            this.setPageSize();

            const totalRowCount = this.getTotalRowCount();
            this.totalPages = Math.floor((totalRowCount - 1) / this.pageSize) + 1;

            if (this.currentPage >= this.totalPages) {
                this.currentPage = this.totalPages - 1;
            }

            if (!_.isNumeric(this.currentPage) || this.currentPage < 0) {
                this.currentPage = 0;
            }

            this.topRowIndex = this.pageSize * this.currentPage;
            this.bottomRowIndex = (this.pageSize * (this.currentPage + 1)) - 1;

            const maxRowAllowed = this.rowModel.getPageLastRow();
            if (this.bottomRowIndex > maxRowAllowed) {
                this.bottomRowIndex = maxRowAllowed;
            }

        } else {
            this.pageSize = this.rowModel.getPageLastRow() + 1;
            this.totalPages = 1;
            this.currentPage = 0;
            this.topRowIndex = 0;
            this.bottomRowIndex = this.rowModel.getPageLastRow();
        }

        this.topRowBounds = this.rowModel.getRowBounds(this.topRowIndex);
        this.bottomRowBounds = this.rowModel.getRowBounds(this.bottomRowIndex);

        this.pixelOffset = _.exists(this.topRowBounds) ? this.topRowBounds.rowTop : 0;
    }
}
