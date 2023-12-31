/** @odoo-module */

import { XMLParser } from "@web/core/utils/xml";
import {
    addLegacyNodeInfo,
    appendAttr,
    appendTo,
    applyInvisibleModifier,
    encodeObjectForTemplate,
    getAllModifiers,
    getModifier,
    isAlwaysInvisible,
    nodeIdentifier,
    tranformStringForExpression,
} from "./compile_helpers";

/**
 * An object containing various information about the current
 * compilation from an Arch to a owl template.
 * @typedef {Object} CompilationContext
 */

/**
 * If a group node has a string, compile a title div for it
 * @param  {Element} node an arch's node
 * @return {Element}
 */
function makeGroupTitleRow(document, node) {
    const titleDiv = document.createElement("div");
    titleDiv.classList.add("o_horizontal_separator");
    titleDiv.textContent = node.getAttribute("string");
    return titleDiv;
}

/**
 * Compiles a template node for a `<group>`arch's node. Only for first level
 * @param {Object} config
 * @param  {Document} config.document The document from which we can create elements
 * @param  {Function} config.compileNode   A function to compile children nodes
 * @param  {number} [config.outerGroupCol] the default group column
 * @param {Object} params The execution parameters
 * @param  {Element} params.node An arch's node
 * @param  {CompilationContext} params.compilationContext
 * @return {Element} The compiled group node
 */
function compileGroup({ document, compileNode, outerGroupCol }, { node, compilationContext }) {
    outerGroupCol = outerGroupCol || 2;

    const group = document.createElement("div");
    group.setAttribute("class", "o_group");

    if (node.hasAttribute("string")) {
        appendTo(group, makeGroupTitleRow(document, node));
    }

    const nbCols =
        "col" in node.attributes ? parseInt(node.getAttribute("col"), 10) : outerGroupCol;
    const colSize = Math.max(1, Math.round(12 / nbCols));

    compilationContext = Object.create(compilationContext);
    compilationContext.groupLevel = (compilationContext.groupLevel || 1) + 1;
    for (let child of node.children) {
        if (child.tagName === "newline") {
            appendTo(group, this.doc.createElement("br"));
            continue;
        }
        const compiled = compileNode(child, compilationContext);
        if (!compiled) {
            continue;
        }
        const colspan =
            "colspan" in child.attributes ? parseInt(node.getAttribute("colspan"), 10) : 1;

        compiled.classList.add(`o_group_col_${colSize * colspan}`);
        appendTo(group, compiled);
    }
    return group;
}

/**
 * Compiles a template node for a `<widget>`arch's node
 * @param {Object} config
 * @param  {Document} config.document The document from which we can create elements
 * @param {Object} params The execution parameters
 * @param  {Element} params.node An arch's node
 * @return {Element} The compiled ViewWidget node
 */
function compileWidget({ document }, { node }) {
    const viewWidget = document.createElement("ViewWidget");
    viewWidget.setAttribute("model", "model");
    viewWidget.setAttribute("widgetName", `"${node.getAttribute("name")}"`);
    if ("title" in node.attributes) {
        viewWidget.setAttribute("title", `"${node.getAttribute("title")}"`);
    }
    addLegacyNodeInfo(node, viewWidget);

    return viewWidget;
}

function setSampleDisable(node) {
    appendAttr(node, "class", "o_sample_data_disabled: model.useSampleModel");
}

export class DashboardCompiler {
    constructor() {
        this.doc = new DOMParser().parseFromString("<templates />", "text/xml");
        this.OUTER_GROUP_COL = 6;
        this.nodeIdentifier = nodeIdentifier();
    }

    compileArch(arch) {
        const node = new XMLParser().parseXML(arch);
        const compiled = this.compile(node, {});
        return new XMLSerializer().serializeToString(compiled);
    }

    compile(node, params = {}) {
        const newRoot = this.doc.createElement("t");
        const child = this.compileNode(node, params);
        appendTo(newRoot, child);
        return newRoot;
    }

    compileDashboard(node, params) {
        const dash = this.doc.createElement("t");
        for (const child of node.children) {
            appendTo(dash, this.compileNode(child, params));
        }
        return dash;
    }

    compileNode(node, params) {
        this.nodeIdentifier(node);
        if (isAlwaysInvisible(node, params)) {
            return;
        }
        switch (node.tagName) {
            case "dashboard": {
                return this.compileDashboard(node, params);
            }
            case "group": {
                return this.compileGroup(node, params);
            }
            case "aggregate": {
                return this.compileStatistic(node, params);
            }
            case "view": {
                return this.compileView(node, params);
            }
            case "formula": {
                return this.compileStatistic(node, params);
            }
            case "widget": {
                return compileWidget({ document: this.doc }, { node });
            }
        }
    }

    compileGroup(node, params) {
        const group = compileGroup(
            {
                compileNode: this.compileNode.bind(this),
                outerGroupCol: this.OUTER_GROUP_COL,
                document: this.doc,
            },
            { node, compilationContext: params }
        );
        if (node.children.length && node.children[0].tagName === "widget") {
            group.classList.add("o_has_widget");
        }
        setSampleDisable(group);
        return group;
    }

    compileView(node) {
        const view = this.doc.createElement("ViewWrapper");
        const type = node.getAttribute("type");
        view.setAttribute("t-props", `getViewWrapperProps("${type}")`);
        view.setAttribute("t-key", "subViewsRenderKey");
        view.setAttribute("class", "o_subview");
        return view;
    }

    compileStatistic(node, params) {
        const agg = this.doc.createElement("DashboardStatistic");
        let aggName;
        if ("name" in node.attributes) {
            aggName = node.getAttribute("name");
        } else {
            aggName = this.nodeIdentifier.idFor(node);
        }
        const displayName = node.getAttribute("string") || aggName;
        agg.setAttribute("displayName", tranformStringForExpression(displayName));
        agg.setAttribute("model", "model");
        agg.setAttribute("name", `"${aggName}"`);
        agg.setAttribute("statisticType", `"${node.tagName}"`);

        if ("value_label" in node.attributes) {
            agg.setAttribute(
                "valueLabel",
                tranformStringForExpression(node.getAttribute("value_label"))
            );
        }

        if ("widget" in node.attributes) {
            agg.setAttribute("widget", `"${node.getAttribute("widget")}"`);
        }

        if ("help" in node.attributes) {
            agg.setAttribute("help", tranformStringForExpression(node.getAttribute("help")));
        }

        const modifiers = getAllModifiers(node);
        if (modifiers) {
            agg.setAttribute("modifiers", `"${encodeObjectForTemplate(modifiers)}"`);
        }

        if (node.tagName === "aggregate") {
            let clickable;
            if (!("clickable" in node.attributes)) {
                clickable = true;
            } else {
                clickable = getModifier(node, "clickable");
            }
            if (clickable) {
                agg.setAttribute("t-on-change-statistic", `onStatisticChange("${aggName}")`);
            }
            agg.setAttribute("clickable", `model.evalDomain(record, ${clickable})`);
        }
        let compiled = agg;
        if (params.groupLevel) {
            const div = this.doc.createElement("div");
            div.setAttribute("class", "o_aggregate_col");
            appendTo(div, agg);
            compiled = div;
        }
        return applyInvisibleModifier({ node, compiled }, params);
    }
}
